import { useEffect, useState, useRef, useCallback } from 'react';
import Peer from 'peerjs';

export const usePeer = (isHost, roomCode) => {
  const [peer, setPeer] = useState(null);
  const [peerId, setPeerId] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const onDataRef = useRef(null);
  const connectionsRef = useRef([]);
  const [connectionsCount, setConnectionsCount] = useState(0);

  useEffect(() => {
    if (!isHost && !roomCode) return;

    setStatus('connecting');
    console.log(`[Peer] Initializing ${isHost ? 'Host' : 'Guest'} for room ${roomCode}`);
    
    const newPeer = new Peer(isHost ? `ipl2026-${roomCode}` : undefined, {
      host: '0.peerjs.com',
      port: 443,
      secure: true,
      debug: 1,
      config: {
        'iceServers': [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ],
        sdpSemantics: 'unified-plan'
      }
    });

    newPeer.on('open', (id) => {
      console.log(`[Peer] ID assigned: ${id}`);
      setPeerId(id);
      setPeer(newPeer);
      setStatus(isHost ? 'connected' : 'connecting');
    });

    newPeer.on('error', (err) => {
      console.error('[Peer] Global error:', err.type, err);
      if (err.type === 'unavailable-id') {
        setError('Room name already taken or in use.');
      } else {
        setError(err.type);
      }
      setStatus('disconnected');
    });

    if (isHost) {
      newPeer.on('connection', (conn) => {
        console.log(`[Peer] Incoming connection from ${conn.peer}`);
        conn.on('open', () => {
          connectionsRef.current.push(conn);
          setConnectionsCount(connectionsRef.current.length);
        });
        conn.on('data', (data) => {
          if (onDataRef.current) onDataRef.current(data, conn.peer);
        });
        conn.on('close', () => {
          connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
          setConnectionsCount(connectionsRef.current.length);
        });
        conn.on('error', () => {
          connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
          setConnectionsCount(connectionsRef.current.length);
        });
      });
    } else if (roomCode) {
      const targetId = `ipl2026-${roomCode}`;
      console.log(`[Peer] Connecting to host: ${targetId}`);
      
      const connectToHost = () => {
        const conn = newPeer.connect(targetId, { reliable: true });

        conn.on('open', () => {
          console.log('[Peer] Connected to host!');
          connectionsRef.current = [conn];
          setConnectionsCount(1);
          setStatus('connected');
        });

        conn.on('data', (data) => {
          if (onDataRef.current) onDataRef.current(data, conn.peer);
        });

        conn.on('error', (err) => {
          console.error('[Peer] Connection error:', err);
          setError('connection-failed');
          setStatus('disconnected');
        });

        conn.on('close', () => {
          console.log('[Peer] Connection closed');
          connectionsRef.current = [];
          setConnectionsCount(0);
          setStatus('disconnected');
        });
      };

      const timer = setTimeout(connectToHost, 1000);
      return () => clearTimeout(timer);
    }

    return () => {
      console.log('[Peer] Destroying peer instance');
      newPeer.destroy();
    };
  }, [isHost, roomCode]);

  const broadcast = useCallback((data) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.open) conn.send(data);
    });
  }, []);

  const sendToHost = useCallback((data) => {
    const conn = connectionsRef.current[0];
    if (!isHost && conn?.open) {
      conn.send(data);
    }
  }, [isHost]);

  const setOnData = useCallback((fn) => {
    onDataRef.current = fn;
  }, []);

  return { peerId, connectionsCount, broadcast, sendToHost, setOnData, error, status };
};
