const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Mafia Server Running');
});

const wss = new WebSocket.Server({ server });

let rooms = {};
let players = {};

function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function broadcastToRoom(roomCode, message) {
    if (rooms[roomCode]) {
        rooms[roomCode].players.forEach(player => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(message));
            }
        });
    }
}

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(7);
    players[playerId] = { ws: ws, currentRoom: null, name: null };
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'create_room') {
                const roomCode = generateCode();
                rooms[roomCode] = {
                    code: roomCode,
                    host: data.name,
                    hostId: playerId,
                    players: [{ id: playerId, name: data.name, ws: ws }],
                    maxPlayers: data.maxPlayers || 10,
                    mafiaCount: data.mafiaCount || 2,
                    doctorCount: data.doctorCount || 1,
                    sheriffCount: data.sheriffCount || 1,
                    discussionTime: data.discussionTime || 60,
                    votingTime: data.votingTime || 30,
                    started: false
                };
                players[playerId].currentRoom = roomCode;
                
                ws.send(JSON.stringify({
                    type: 'room_created',
                    code: roomCode,
                    settings: rooms[roomCode]
                }));
            }
            
            if (data.type === 'join_room') {
                const room = rooms[data.code];
                if (room && !room.started) {
                    room.players.push({ id: playerId, name: data.name, ws: ws });
                    players[playerId].currentRoom = data.code;
                    
                    ws.send(JSON.stringify({
                        type: 'room_joined',
                        code: data.code,
                        settings: {
                            maxPlayers: room.maxPlayers,
                            mafiaCount: room.mafiaCount,
                            doctorCount: room.doctorCount,
                            sheriffCount: room.sheriffCount,
                            discussionTime: room.discussionTime,
                            votingTime: room.votingTime
                        },
                        players: room.players.map(p => p.name),
                        host: room.host
                    }));
                    
                    broadcastToRoom(data.code, {
                        type: 'player_list',
                        players: room.players.map(p => p.name),
                        host: room.host
                    });
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Комната не найдена или уже началась'
                    }));
                }
            }
            
            if (data.type === 'start_game') {
                const room = rooms[data.code];
                if (room && room.hostId === playerId) {
                    room.started = true;
                    room.mafiaCount = data.mafiaCount || room.mafiaCount;
                    room.doctorCount = data.doctorCount || room.doctorCount;
                    room.sheriffCount = data.sheriffCount || room.sheriffCount;
                    
                    // ОТПРАВЛЯЕМ ВСЕМ ИГРОКАМ В КОМНАТЕ
                    broadcastToRoom(data.code, {
                        type: 'game_started',
                        settings: {
                            maxPlayers: room.maxPlayers,
                            mafiaCount: room.mafiaCount,
                            doctorCount: room.doctorCount,
                            sheriffCount: room.sheriffCount,
                            discussionTime: room.discussionTime,
                            votingTime: room.votingTime
                        },
                        players: room.players.map(p => p.name)
                    });
                }
            }
            
            if (data.type === 'chat') {
                const room = rooms[data.code];
                if (room) {
                    broadcastToRoom(data.code, {
                        type: 'chat',
                        from: data.from,
                        message: data.message,
                        color: data.color || '#FFFFFF'
                    });
                }
            }
            
            if (data.type === 'kick_player') {
                const room = rooms[data.code];
                if (room && room.hostId === playerId) {
                    const kicked = room.players.find(p => p.name === data.playerName);
                    if (kicked) {
                        kicked.ws.send(JSON.stringify({ type: 'kicked' }));
                        room.players = room.players.filter(p => p.name !== data.playerName);
                        broadcastToRoom(data.code, {
                            type: 'player_list',
                            players: room.players.map(p => p.name),
                            host: room.host
                        });
                    }
                }
            }
            
            if (data.type === 'leave_room') {
                const room = rooms[data.code];
                if (room) {
                    room.players = room.players.filter(p => p.id !== playerId);
                    if (room.players.length === 0) {
                        delete rooms[data.code];
                    } else {
                        if (room.hostId === playerId) {
                            room.hostId = room.players[0].id;
                            room.host = room.players[0].name;
                        }
                        broadcastToRoom(data.code, {
                            type: 'player_list',
                            players: room.players.map(p => p.name),
                            host: room.host
                        });
                    }
                }
            }
            
        } catch (e) {
            console.error(e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
