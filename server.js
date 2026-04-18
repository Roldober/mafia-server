const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Mafia Server Running');
});

const wss = new WebSocket.Server({ server });

let rooms = {};
let clients = {};

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
        rooms[roomCode].players.forEach(clientId => {
            const client = clients[clientId];
            if (client && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify(message));
            }
        });
    }
}

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const clientId = urlParams.get('clientId') || Math.random().toString(36);
    
    clients[clientId] = { ws: ws, currentRoom: null, name: null };
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'set_name') {
                clients[clientId].name = data.name;
            }
            
            if (data.type === 'create_room') {
                const roomCode = generateCode();
                rooms[roomCode] = {
                    code: roomCode,
                    host: clientId,
                    players: [clientId],
                    maxPlayers: data.maxPlayers || 10,
                    mafiaCount: data.mafiaCount || 2,
                    doctorCount: data.doctorCount || 1,
                    sheriffCount: data.sheriffCount || 1,
                    discussionTime: data.discussionTime || 60,
                    votingTime: data.votingTime || 30,
                    started: false
                };
                clients[clientId].currentRoom = roomCode;
                
                ws.send(JSON.stringify({
                    type: 'room_created',
                    code: roomCode
                }));
            }
            
            if (data.type === 'join_room') {
                const room = rooms[data.code];
                
                // ПРОВЕРКА: комната существует?
                if (!room) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Комната не найдена'
                    }));
                    return;
                }
                
                // ПРОВЕРКА: комната не начата и не заполнена?
                if (room.started) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Игра уже началась'
                    }));
                    return;
                }
                
                if (room.players.length >= room.maxPlayers) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Комната заполнена'
                    }));
                    return;
                }
                
                // Всё ок, добавляем игрока
                room.players.push(clientId);
                clients[clientId].currentRoom = data.code;
                
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
                    players: room.players.map(id => clients[id].name),
                    host: clients[room.host].name
                }));
                
                broadcastToRoom(data.code, {
                    type: 'player_list',
                    players: room.players.map(id => clients[id].name),
                    host: clients[room.host].name
                });
            }
            
            if (data.type === 'chat') {
                const room = rooms[data.code];
                if (room && room.players.includes(clientId)) {
                    broadcastToRoom(data.code, {
                        type: 'chat',
                        from: clients[clientId].name,
                        message: data.message,
                        color: data.color || '#FFFFFF'
                    });
                }
            }
            
            if (data.type === 'leave_room') {
                const room = rooms[data.code];
                if (room) {
                    room.players = room.players.filter(id => id !== clientId);
                    
                    if (room.players.length === 0) {
                        delete rooms[data.code];
                    } else {
                        if (room.host === clientId) {
                            room.host = room.players[0];
                        }
                        broadcastToRoom(data.code, {
                            type: 'player_list',
                            players: room.players.map(id => clients[id].name),
                            host: clients[room.host].name
                        });
                    }
                }
                clients[clientId].currentRoom = null;
            }
            
            if (data.type === 'kick_player') {
                const room = rooms[data.code];
                if (room && room.host === clientId) {
                    const kickedId = Object.keys(clients).find(id => clients[id].name === data.playerName);
                    if (kickedId) {
                        room.players = room.players.filter(id => id !== kickedId);
                        clients[kickedId].ws.send(JSON.stringify({ type: 'kicked' }));
                        clients[kickedId].currentRoom = null;
                        
                        broadcastToRoom(data.code, {
                            type: 'player_list',
                            players: room.players.map(id => clients[id].name),
                            host: clients[room.host].name
                        });
                    }
                }
            }
            
            if (data.type === 'start_game') {
                const room = rooms[data.code];
                if (room && room.host === clientId && room.players.length >= 4) {
                    room.started = true;
                    room.mafiaCount = data.mafiaCount || room.mafiaCount;
                    room.doctorCount = data.doctorCount || room.doctorCount;
                    room.sheriffCount = data.sheriffCount || room.sheriffCount;
                    
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
                        players: room.players.map(id => clients[id].name)
                    });
                }
            }
            
            if (data.type === 'update_settings') {
                const room = rooms[data.code];
                if (room && room.host === clientId) {
                    room.mafiaCount = data.mafiaCount || room.mafiaCount;
                    room.doctorCount = data.doctorCount || room.doctorCount;
                    room.sheriffCount = data.sheriffCount || room.sheriffCount;
                    room.discussionTime = data.discussionTime || room.discussionTime;
                    room.votingTime = data.votingTime || room.votingTime;
                }
            }
            
        } catch (e) {
            console.error(e);
        }
    });
    
    ws.on('close', () => {
        const roomCode = clients[clientId]?.currentRoom;
        if (roomCode && rooms[roomCode]) {
            const room = rooms[roomCode];
            room.players = room.players.filter(id => id !== clientId);
            
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                if (room.host === clientId) {
                    room.host = room.players[0];
                }
                broadcastToRoom(roomCode, {
                    type: 'player_list',
                    players: room.players.map(id => clients[id]?.name || 'Игрок'),
                    host: clients[room.host]?.name || 'Игрок'
                });
            }
        }
        delete clients[clientId];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
