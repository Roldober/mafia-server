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

function updateRoomList() {
    const roomList = [];
    for (let code in rooms) {
        if (!rooms[code].started) {
            roomList.push({
                code: code,
                host: rooms[code].host,
                players: rooms[code].players.length,
                maxPlayers: rooms[code].maxPlayers
            });
        }
    }
    
    for (let playerId in players) {
        const player = players[playerId];
        if (player.ws.readyState === WebSocket.OPEN && !player.currentRoom) {
            player.ws.send(JSON.stringify({
                type: 'room_list',
                rooms: roomList
            }));
        }
    }
}

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(7);
    players[playerId] = { ws: ws, currentRoom: null, name: null };
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'set_name') {
                players[playerId].name = data.name;
            }
            
            if (data.type === 'create_room') {
                const roomCode = generateCode();
                rooms[roomCode] = {
                    code: roomCode,
                    host: data.name,
                    hostId: playerId,
                    players: [{ id: playerId, name: data.name, ws: ws }],
                    maxPlayers: data.maxPlayers,
                    mafiaCount: data.mafiaCount,
                    doctorCount: data.doctorCount,
                    sheriffCount: data.sheriffCount,
                    discussionTime: data.discussionTime,
                    votingTime: data.votingTime,
                    started: false
                };
                players[playerId].currentRoom = roomCode;
                
                ws.send(JSON.stringify({
                    type: 'room_created',
                    code: roomCode,
                    settings: {
                        maxPlayers: data.maxPlayers,
                        mafiaCount: data.mafiaCount,
                        doctorCount: data.doctorCount,
                        sheriffCount: data.sheriffCount,
                        discussionTime: data.discussionTime,
                        votingTime: data.votingTime
                    }
                }));
                
                updateRoomList();
            }
            
            if (data.type === 'get_rooms') {
                updateRoomList();
            }
            
            if (data.type === 'join_room') {
                const room = rooms[data.code];
                if (room && !room.started && room.players.length < room.maxPlayers) {
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
                    
                    updateRoomList();
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Комната не найдена или заполнена'
                    }));
                }
            }
            
            if (data.type === 'chat') {
                const room = rooms[data.code];
                if (room) {
                    broadcastToRoom(data.code, {
                        type: 'chat',
                        from: data.from,
                        message: data.message,
                        color: data.color
                    });
                }
            }
            
            if (data.type === 'kick_player') {
                const room = rooms[data.code];
                if (room && room.hostId === playerId) {
                    const kickedPlayer = room.players.find(p => p.name === data.playerName);
                    if (kickedPlayer && kickedPlayer.id !== playerId) {
                        kickedPlayer.ws.send(JSON.stringify({
                            type: 'kicked',
                            reason: 'Вас выгнали из комнаты'
                        }));
                        players[kickedPlayer.id].currentRoom = null;
                        room.players = room.players.filter(p => p.id !== kickedPlayer.id);
                        
                        broadcastToRoom(data.code, {
                            type: 'player_list',
                            players: room.players.map(p => p.name),
                            host: room.host
                        });
                        
                        broadcastToRoom(data.code, {
                            type: 'chat',
                            from: 'Система',
                            message: data.playerName + ' был выгнан из комнаты',
                            color: '#FF0000'
                        });
                    }
                }
            }
            
            if (data.type === 'leave_room') {
                const room = rooms[data.code];
                if (room) {
                    room.players = room.players.filter(p => p.id !== playerId);
                    players[playerId].currentRoom = null;
                    
                    if (room.players.length === 0) {
                        delete rooms[data.code];
                    } else {
                        if (room.hostId === playerId) {
                            room.hostId = room.players[0].id;
                            room.host = room.players[0].name;
                            
                            broadcastToRoom(data.code, {
                                type: 'chat',
                                from: 'Система',
                                message: room.host + ' стал новым создателем',
                                color: '#FFAA00'
                            });
                        }
                        
                        broadcastToRoom(data.code, {
                            type: 'player_list',
                            players: room.players.map(p => p.name),
                            host: room.host
                        });
                        
                        broadcastToRoom(data.code, {
                            type: 'chat',
                            from: 'Система',
                            message: data.name + ' покинул комнату',
                            color: '#FFAA00'
                        });
                    }
                    
                    updateRoomList();
                }
            }
            
            if (data.type === 'update_settings') {
                const room = rooms[data.code];
                if (room && room.hostId === playerId) {
                    room.mafiaCount = data.mafiaCount;
                    room.doctorCount = data.doctorCount;
                    room.sheriffCount = data.sheriffCount;
                    room.discussionTime = data.discussionTime;
                    room.votingTime = data.votingTime;
                    
                    broadcastToRoom(data.code, {
                        type: 'settings_updated',
                        settings: {
                            mafiaCount: room.mafiaCount,
                            doctorCount: room.doctorCount,
                            sheriffCount: room.sheriffCount,
                            discussionTime: room.discussionTime,
                            votingTime: room.votingTime
                        }
                    });
                }
            }
            
            if (data.type === 'start_game') {
                const room = rooms[data.code];
                if (room && room.hostId === playerId) {
                    room.started = true;
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
                    updateRoomList();
                }
            }
            
        } catch (e) {
            console.error(e);
        }
    });
    
    ws.on('close', () => {
        const roomCode = players[playerId]?.currentRoom;
        if (roomCode && rooms[roomCode]) {
            const room = rooms[roomCode];
            room.players = room.players.filter(p => p.id !== playerId);
            
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                if (room.hostId === playerId) {
                    room.hostId = room.players[0].id;
                    room.host = room.players[0].name;
                    
                    broadcastToRoom(roomCode, {
                        type: 'chat',
                        from: 'Система',
                        message: room.host + ' стал новым создателем',
                        color: '#FFAA00'
                    });
                }
                
                broadcastToRoom(roomCode, {
                    type: 'player_list',
                    players: room.players.map(p => p.name),
                    host: room.host
                });
            }
            updateRoomList();
        }
        delete players[playerId];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
