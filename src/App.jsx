import React, { useState, useEffect, useReducer, useCallback } from 'react';
import { usePeer } from './hooks/usePeer';
import { IPL_TEAMS } from './data/iplTeams';
import { PLAYERS } from './data/players';
import { Trophy, Users, Timer, User, Wallet, Hammer, ArrowRight, Check, X, Shield, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Reducer & Initial State ---
const initialState = {
  phase: 'lobby', // lobby, team_select, auction, finished
  players: {}, // { peerId: { name, team, purse, roster, isHost } }
  currentPlayerIndex: 0,
  activeBid: null, // { amount, bidderId, bidderName, bidderTeam }
  timeLeft: 30,
  soldPlayers: [],
  roomCode: '',
  isHost: false,
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'SET_ROOM':
      return { ...state, roomCode: action.payload.code, isHost: action.payload.isHost };
    case 'SYNC_STATE':
      // CRITICAL: Preserve local isHost and roomCode to prevent sync loops
      return { 
        ...state, 
        ...action.payload, 
        isHost: state.isHost, 
        roomCode: state.roomCode 
      };
    case 'ADD_PLAYER':
      return {
        ...state,
        players: {
          ...state.players,
          [action.payload.id]: {
            name: action.payload.name,
            team: null,
            purse: 12000, // 120 Cr
            roster: [],
            isHost: action.payload.isHost || false,
          }
        }
      };
    case 'SELECT_TEAM':
      return {
        ...state,
        players: {
          ...state.players,
          [action.payload.id]: {
            ...state.players[action.payload.id],
            team: action.payload.team
          }
        }
      };
    case 'START_GAME':
      return { ...state, phase: action.payload };
    case 'NEW_BID':
      return {
        ...state,
        activeBid: action.payload,
        timeLeft: 30, // Reset timer on bid
      };
    case 'TICK':
      return { ...state, timeLeft: Math.max(0, state.timeLeft - 1) };
    case 'RESET_TIMER':
      return { ...state, timeLeft: 30 };
    case 'SOLD':
      const soldPlayer = PLAYERS[state.currentPlayerIndex];
      // Only add to soldPlayers if there was an active bid
      if (!state.activeBid) {
        return {
          ...state,
          currentPlayerIndex: state.currentPlayerIndex + 1,
          activeBid: null,
          timeLeft: 30,
        };
      }
      
      const winnerId = state.activeBid.bidderId;
      return {
        ...state,
        soldPlayers: [...state.soldPlayers, { ...soldPlayer, ...state.activeBid }],
        currentPlayerIndex: state.currentPlayerIndex + 1,
        activeBid: null,
        timeLeft: 30,
        players: {
          ...state.players,
          [winnerId]: {
            ...state.players[winnerId],
            purse: state.players[winnerId].purse - state.activeBid.amount,
            roster: [...state.players[winnerId].roster, soldPlayer],
          }
        }
      };
    case 'SKIP_PLAYER':
       return {
         ...state,
         currentPlayerIndex: state.currentPlayerIndex + 1,
         activeBid: null,
         timeLeft: 30,
       };
    default:
      return state;
  }
}

export default function App() {
  const [gameState, dispatch] = useReducer(gameReducer, initialState);
  const [userName, setUserName] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [myId, setMyId] = useState(null);

  const { peerId, connectionsCount, broadcast, sendToHost, setOnData, error, status } = usePeer(gameState.isHost, gameState.roomCode);

  useEffect(() => {
    if (peerId) {
      setMyId(peerId);
      // If I'm the host and I just got my ID, add myself to the players roster
      if (gameState.isHost && !gameState.players[peerId]) {
        dispatch({ type: 'ADD_PLAYER', payload: { id: peerId, name: userName, isHost: true } });
      }
    }
  }, [peerId, gameState.isHost, userName]);

  // Handle incoming P2P messages
  useEffect(() => {
    setOnData((data, senderId) => {
      console.log(`[P2P] Received: ${data.type} from ${senderId}`);
      if (data.type === 'STATE_SYNC') {
        // Only guests should sync state from the host
        if (!gameState.isHost) {
          dispatch({ type: 'SYNC_STATE', payload: data.state });
        }
      } else if (data.type === 'PLAYER_JOIN') {
        if (gameState.isHost) {
          console.log(`[Host] ${data.name} joined with ID ${senderId}`);
          dispatch({ type: 'ADD_PLAYER', payload: { id: senderId, name: data.name } });
        }
      } else if (data.type === 'SELECT_TEAM') {
        if (gameState.isHost) {
          dispatch({ type: 'SELECT_TEAM', payload: { id: senderId, team: data.team } });
        }
      } else if (data.type === 'BID') {
        if (gameState.isHost) {
          const player = gameState.players[senderId];
          const currentAmount = gameState.activeBid?.amount || PLAYERS[gameState.currentPlayerIndex].basePrice;
          if (player && player.purse >= data.amount && data.amount > currentAmount) {
            dispatch({ 
              type: 'NEW_BID', 
              payload: { 
                amount: data.amount, 
                bidderId: senderId, 
                bidderName: player.name, 
                bidderTeam: player.team 
              } 
            });
          }
        }
      }
    });
  }, [gameState.isHost, gameState.activeBid, gameState.currentPlayerIndex, gameState.players, setOnData]);

  // Host: Broadcast state on significant changes
  useEffect(() => {
    if (gameState.isHost && status === 'connected' && connectionsCount > 0) {
      console.log('[Host] Broadcasting current state to all connected peers');
      broadcast({ type: 'STATE_SYNC', state: gameState });
    }
  }, [gameState, broadcast, status, connectionsCount]);

  // Host: Timer logic
  useEffect(() => {
    if (gameState.isHost && gameState.phase === 'auction') {
      const timer = setInterval(() => {
        if (gameState.timeLeft > 0) {
          dispatch({ type: 'TICK' });
        } else {
          // If no bid has been made, skip the player instead of selling
          if (gameState.activeBid) {
            dispatch({ type: 'SOLD' });
          } else {
            dispatch({ type: 'SKIP_PLAYER' });
          }
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [gameState.isHost, gameState.phase, gameState.timeLeft]);

  // --- Actions ---
  const createRoom = () => {
    if (!userName) return;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    dispatch({ type: 'SET_ROOM', payload: { code, isHost: true } });
  };

  const joinRoom = () => {
    if (!userName || !inputCode) return;
    dispatch({ type: 'SET_ROOM', payload: { code: inputCode, isHost: false } });
  };

  // Guest: Send join request once connected
  useEffect(() => {
    if (!gameState.isHost && status === 'connected' && gameState.roomCode) {
      console.log('[Guest] Sending join request to host...');
      sendToHost({ type: 'PLAYER_JOIN', name: userName });
    }
  }, [status, gameState.isHost, gameState.roomCode, userName, sendToHost]);

  const handleSelectTeam = (teamId) => {
    if (gameState.isHost) {
      dispatch({ type: 'SELECT_TEAM', payload: { id: myId, team: teamId } });
    } else {
      sendToHost({ type: 'SELECT_TEAM', team: teamId });
    }
  };

  const placeBid = (increment) => {
    const currentPrice = gameState.activeBid?.amount || PLAYERS[gameState.currentPlayerIndex].basePrice;
    const newAmount = currentPrice + increment;
    if (gameState.isHost) {
      dispatch({ 
        type: 'NEW_BID', 
        payload: { 
          amount: newAmount, 
          bidderId: myId, 
          bidderName: userName, 
          bidderTeam: gameState.players[myId]?.team 
        } 
      });
    } else {
      sendToHost({ type: 'BID', amount: newAmount });
    }
  };

  // --- Render Helpers ---
  const isTeamTaken = (teamId) => Object.values(gameState.players).some(p => p.team === teamId);

  // --- Pages ---
  if (gameState.phase === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-full max-w-md glass p-8 rounded-3xl gold-outline">
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 ipl-gradient rounded-full flex items-center justify-center mb-4">
              <Trophy className="text-ipl-gold w-10 h-10" />
            </div>
            <h1 className="text-3xl font-black text-white italic tracking-tighter uppercase">TATA IPL 2026</h1>
            <p className="text-ipl-gold font-bold tracking-widest text-xs uppercase mt-1">Multiplayer Auction</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-ipl-gold uppercase mb-1 block">Your Name</label>
              <input 
                type="text" 
                value={userName} 
                onChange={e => setUserName(e.target.value)}
                placeholder="Enter name"
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-ipl-gold transition-all"
              />
            </div>

            <div className="pt-4 space-y-3">
              <button 
                onClick={createRoom}
                disabled={!userName}
                className="w-full bg-ipl-gold text-ipl-blue font-black py-4 rounded-xl uppercase hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                Create New Room <Plus className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-4 py-2">
                <div className="h-px bg-white/10 flex-1" />
                <span className="text-white/40 text-xs font-bold">OR JOIN ROOM</span>
                <div className="h-px bg-white/10 flex-1" />
              </div>

              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={inputCode} 
                  onChange={e => setInputCode(e.target.value)}
                  placeholder="6-Digit Code"
                  className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-ipl-gold transition-all font-mono"
                />
                <button 
                  onClick={joinRoom}
                  disabled={!userName || inputCode.length < 6}
                  className="bg-white/10 hover:bg-white/20 text-white px-6 rounded-xl font-bold uppercase transition-all disabled:opacity-50"
                >
                  Join
                </button>
              </div>
            </div>
          </div>
        </motion.div>
        
        {gameState.roomCode && (
          <div className="mt-8 text-center">
            <div className="flex justify-center mb-4">
              <div className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border ${
                status === 'connected' ? 'bg-green-500/10 border-green-500 text-green-500' :
                status === 'connecting' ? 'bg-ipl-gold/10 border-ipl-gold text-ipl-gold animate-pulse' :
                'bg-red-500/10 border-red-500 text-red-500'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500' : status === 'connecting' ? 'bg-ipl-gold' : 'bg-red-500'}`} />
                Status: {status}
              </div>
            </div>

            <p className="text-white/60 text-sm">{gameState.isHost ? 'Room Created! Shared Code:' : 'Joining Room...'}</p>
            <p className="text-4xl font-black text-ipl-gold tracking-widest mt-2">{gameState.roomCode}</p>
            
            <div className="mt-6 glass p-6 rounded-2xl">
              <h3 className="text-xs font-bold text-ipl-gold uppercase mb-4">Players Connected ({Object.keys(gameState.players).length})</h3>
              <div className="flex flex-wrap justify-center gap-3 min-h-[40px]">
                {Object.values(gameState.players).length > 0 ? (
                  Object.values(gameState.players).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg border border-white/10">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="font-bold text-sm">{p.name}</span>
                      {p.isHost && <Shield className="w-3 h-3 text-ipl-gold" />}
                    </div>
                  ))
                ) : (
                  <p className="text-white/20 text-xs italic tracking-wide">Waiting for players to connect...</p>
                )}
              </div>
              
              {gameState.isHost && Object.keys(gameState.players).length >= 1 && (
                <button 
                  onClick={() => dispatch({ type: 'START_GAME', payload: 'team_select' })}
                  className="mt-8 bg-green-600 hover:bg-green-500 text-white font-black px-8 py-3 rounded-xl uppercase flex items-center gap-2 mx-auto"
                >
                  Start Game <ArrowRight className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (gameState.phase === 'team_select') {
    return (
      <div className="min-h-screen p-6 max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 bg-white/5 p-4 rounded-2xl border border-white/10">
          <div>
            <h2 className="text-2xl font-black italic uppercase italic">Select Your Team</h2>
            <p className="text-ipl-gold text-xs font-bold tracking-widest">PHASE 2 / 3</p>
          </div>
          <div className="flex gap-2">
            {Object.values(gameState.players).map((p, i) => (
              <div key={i} className="bg-white/10 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2">
                <span>{p.name}:</span>
                <span className={p.team ? "text-green-400" : "text-white/40"}>{p.team || 'Wait...'}</span>
              </div>
            ))}
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {IPL_TEAMS.map((team) => {
            const taken = isTeamTaken(team.id);
            const myTeam = gameState.players[myId]?.team === team.id;
            
            return (
              <motion.button
                key={team.id}
                whileHover={!taken ? { scale: 1.05 } : {}}
                whileTap={!taken ? { scale: 0.95 } : {}}
                onClick={() => !taken && handleSelectTeam(team.id)}
                disabled={taken && !myTeam}
                className={`
                  relative h-48 rounded-2xl border-2 flex flex-col items-center justify-center p-4 transition-all overflow-hidden
                  ${myTeam ? 'border-ipl-gold bg-ipl-gold/20' : taken ? 'border-white/10 bg-black/40 grayscale' : 'border-white/20 bg-white/5 hover:border-white/40'}
                `}
              >
                <div className="w-24 h-24 mb-4 overflow-hidden rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center">
                  <img src={team.logo} alt={team.id} className="w-full h-full object-contain p-2" />
                </div>
                <div className="text-xl font-black leading-tight uppercase text-center mt-2">{team.id}</div>
                <div className="text-[10px] font-bold opacity-60 text-center">{team.name}</div>
                
                {myTeam && <div className="absolute top-2 right-2 bg-ipl-gold text-ipl-blue p-1 rounded-full"><Check className="w-3 h-3" /></div>}
                {taken && !myTeam && <div className="absolute inset-0 flex items-center justify-center bg-black/60 font-black text-xs uppercase tracking-tighter">Already Taken</div>}
              </motion.button>
            )
          })}
        </div>
        
        {gameState.isHost && (
          <div className="mt-12 text-center">
            <button 
              onClick={() => dispatch({ type: 'START_GAME', payload: 'auction' })}
              className="bg-ipl-gold text-ipl-blue font-extrabold px-12 py-4 rounded-full uppercase text-xl gold-outline hover:scale-110 active:scale-95 transition-all"
            >
              Go to Auction Dashboard
            </button>
          </div>
        )}
      </div>
    );
  }

  if (gameState.phase === 'auction') {
    const currentPlayer = PLAYERS[gameState.currentPlayerIndex];
    const myDetails = gameState.players[myId];
    
    return (
      <div className="min-h-screen p-4 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 glass px-6 py-3 rounded-2xl border border-ipl-gold/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full ipl-gradient flex items-center justify-center text-ipl-gold border border-ipl-gold/50">
              <Hammer className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black italic tracking-tighter uppercase leading-none">Live Auction</h2>
              <p className="text-[10px] font-bold text-ipl-gold tracking-[0.2em] uppercase">TATA IPL 2026</p>
            </div>
          </div>
          
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-[10px] font-bold text-white/40 uppercase">My Team</p>
              <p className="text-sm font-black text-ipl-gold uppercase tracking-tighter">
                {myDetails?.team ? IPL_TEAMS.find(t => t.id === myDetails.team)?.id : 'N/A'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-bold text-white/40 uppercase">Purse Left</p>
              <p className="text-sm font-black text-green-400">₹{(myDetails?.purse / 100).toFixed(2)} Cr</p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Main Content: Player Card */}
          <div className="flex-[3] flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 glass rounded-3xl p-8 relative overflow-hidden flex flex-col items-center justify-center border border-white/10">
              {/* Timer Background */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                 <div className={`text-[200px] font-black opacity-5 transition-all duration-300 ${gameState.timeLeft <= 10 ? 'text-red-500 scale-110' : 'text-white'}`}>
                   {gameState.timeLeft}
                 </div>
              </div>

              <motion.div 
                key={currentPlayer?.id}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="relative z-10 flex flex-col items-center text-center"
              >
                <div className="w-32 h-32 rounded-full border-4 border-ipl-gold/30 p-1 mb-4 flex items-center justify-center bg-white/5 relative">
                   <User className="w-20 h-20 text-white/20" />
                   {/* Role Badge */}
                   <div className="absolute -bottom-2 bg-ipl-gold text-ipl-blue px-3 py-1 rounded-full text-[10px] font-black uppercase">
                     {currentPlayer?.role}
                   </div>
                </div>
                
                <h3 className="text-4xl font-black italic uppercase tracking-tighter mb-1 select-none">{currentPlayer?.name}</h3>
                <div className="flex items-center gap-2 mb-6">
                   <span className="bg-white/10 px-3 py-1 rounded-full text-xs font-bold uppercase">{currentPlayer?.country}</span>
                   <span className="bg-white/10 px-3 py-1 rounded-full text-xs font-bold uppercase">{currentPlayer?.category}</span>
                </div>

                <div className="flex gap-4">
                  <div className="glass px-8 py-4 rounded-2xl border-green-500/20">
                    <p className="text-[10px] font-bold text-white/40 uppercase mb-1">Base Price</p>
                    <p className="text-2xl font-black text-white">₹{currentPlayer?.basePrice}L</p>
                  </div>
                  <div className="glass px-8 py-4 rounded-2xl border-ipl-gold/50 bg-ipl-gold/5">
                    <p className="text-[10px] font-bold text-ipl-gold uppercase mb-1">Current Bid</p>
                    <p className="text-2xl font-black text-ipl-gold">
                       {gameState.activeBid ? `₹${gameState.activeBid.amount}L` : 'Opening...'}
                    </p>
                  </div>
                </div>

                {gameState.activeBid && (
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-8 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden bg-white/10 border border-white/20">
                      <img 
                        src={IPL_TEAMS.find(t => t.id === gameState.activeBid.bidderTeam)?.logo} 
                        alt={gameState.activeBid.bidderTeam}
                        className="w-full h-full object-contain p-1.5"
                      />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] font-bold text-white/40 uppercase">Highest Bidder</p>
                      <p className="text-sm font-black text-ipl-gold uppercase tracking-tighter">
                        {gameState.activeBid.bidderTeam} ({gameState.activeBid.bidderName})
                      </p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            </div>

            {/* Bidding Controls */}
            <div className="h-32 glass rounded-3xl p-4 flex items-center justify-center gap-4">
               <button 
                 onClick={() => placeBid(20)}
                 disabled={!myDetails?.team || (gameState.activeBid?.bidderId === myId) || (myDetails.purse < (gameState.activeBid?.amount || 0) + 20)}
                 className="flex-1 gold-outline bg-ipl-gold hover:bg-white text-ipl-blue h-full rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 disabled:opacity-30 group"
               >
                 <span className="text-xs font-black uppercase text-ipl-blue/60 group-hover:text-ipl-blue/40">Bid Next</span>
                 <span className="text-2xl font-black uppercase tracking-tighter">+20L</span>
               </button>
               
               <button 
                 onClick={() => placeBid(50)}
                 disabled={!myDetails?.team || (gameState.activeBid?.bidderId === myId) || (myDetails.purse < (gameState.activeBid?.amount || 0) + 50)}
                 className="flex-1 border-2 border-white/20 hover:bg-white/10 h-full rounded-2xl flex flex-col items-center justify-center transition-all active:scale-95 disabled:opacity-30"
               >
                 <span className="text-xs font-black uppercase text-white/40">Aggressive</span>
                 <span className="text-2xl font-black uppercase tracking-tighter">+50L</span>
               </button>

               {gameState.isHost && (
                 <button 
                   onClick={() => dispatch({ type: 'SKIP_PLAYER' })}
                   className="w-20 border border-white/10 hover:bg-red-500/10 h-full rounded-2xl flex items-center justify-center flex-col gap-1 transition-all"
                 >
                   <X className="w-5 h-5 text-red-400" />
                   <span className="text-[8px] font-bold uppercase">Skip</span>
                 </button>
               )}
            </div>
          </div>

          {/* Sidebar: Teams & Leaderboard */}
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 glass rounded-3xl flex flex-col overflow-hidden">
               <div className="p-4 border-b border-white/10 bg-white/5 font-black uppercase text-xs italic tracking-widest text-ipl-gold">
                 Team Franchises
               </div>
               <div className="flex-1 overflow-y-auto p-4 space-y-2">
                 {Object.entries(gameState.players).map(([id, p]) => (
                   <div key={id} className={`p-3 rounded-xl border flex items-center justify-between ${id === myId ? 'border-ipl-gold bg-ipl-gold/10' : 'border-white/5 bg-white/5'}`}>
                     <div className="truncate pr-2">
                       <p className="text-[10px] font-bold text-white/40 uppercase leading-none mb-1">{p.team || 'No Team'}</p>
                       <p className="text-xs font-black truncate">{p.name}</p>
                     </div>
                     <div className="text-right">
                       <p className="text-xs font-bold text-green-400">₹{(p.purse / 100).toFixed(2)} Cr</p>
                       <p className="text-[8px] font-bold opacity-40 uppercase">{p.roster.length} Players</p>
                     </div>
                   </div>
                 ))}
               </div>
            </div>

            <div className="h-48 glass rounded-3xl p-4 overflow-hidden flex flex-col">
              <div className="font-black uppercase text-[10px] tracking-widest text-white/40 mb-3 flex items-center gap-2">
                <Users className="w-3 h-3" /> Recent Buys
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {gameState.soldPlayers.slice().reverse().map((s, i) => (
                  <div key={i} className="text-[10px] flex justify-between items-center bg-white/5 p-2.5 rounded-xl border border-white/5">
                    <span className="font-bold flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full overflow-hidden bg-white/10 flex-shrink-0 border border-white/10">
                        <img 
                          src={IPL_TEAMS.find(t => t.id === s.bidderTeam)?.logo} 
                          alt={s.bidderTeam}
                          className="w-full h-full object-contain p-0.5" 
                        />
                      </div>
                      <span className="text-ipl-gold">{s.bidderTeam}</span>
                      <span className="opacity-40 font-normal">got</span>
                      <span className="text-white/90">{s.name}</span>
                    </span>
                    <span className="font-black text-white/60">₹{s.amount}L</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-full text-xs font-black uppercase border border-white/20 z-50">
            Networking Error: {error}
          </div>
        )}
      </div>
    );
  }

  return null;
}
