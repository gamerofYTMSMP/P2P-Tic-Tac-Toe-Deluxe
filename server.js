// P2P Tic-Tac-Toe Deluxe+ Signaling Server
// This server does NOT handle game logic. It only introduces two players to each other.
// All game data is sent directly between players (P2P) via WebRTC.

import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Create a simple HTTP server to attach the WebSocket server to
const server = createServer();
const wss = new WebSocketServer({ server });

// In-memory storage for rooms. In a real production app, you might use a database like Redis.
const rooms = {};

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (rooms[code]); // Ensure the code is unique
    return code;
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Invalid JSON received:', message);
            return;
        }

        const { type, roomCode, name, password, isPublic, sdp, candidate } = data;

        switch (type) {
            case 'create_room': {
                const newRoomCode = generateRoomCode();
                rooms[newRoomCode] = {
                    name,
                    isPublic: isPublic || false,
                    password: password || null, // Store password
                    host: ws,
                    client: null,
                };
                ws.roomCode = newRoomCode; // Attach room code to the WebSocket connection object
                ws.send(JSON.stringify({ type: 'room_created', roomCode: newRoomCode }));
                console.log(`Room created: ${newRoomCode} (Public: ${isPublic}, Password: ${!!password})`);
                broadcastRoomsList();
                break;
            }

            case 'join_room': {
                const room = rooms[roomCode];
                if (!room) {
                    ws.send(JSON.stringify({ type: 'room_not_found', message: 'Room not found.' }));
                    return;
                }
                if (room.client) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room is full.' }));
                    return;
                }
                // Check password
                if (room.password && room.password !== password) {
                    ws.send(JSON.stringify({ type: 'wrong_password', message: 'Incorrect password.' }));
                    return;
                }

                room.client = ws;
                ws.roomCode = roomCode;
                console.log(`Client joined room: ${roomCode}`);

                // Notify both players
                room.host.send(JSON.stringify({ type: 'room_joined' }));
                // We don't need to notify the joiner, they proceed with P2P setup
                break;
            }

            case 'get_rooms': {
                const publicRooms = Object.entries(rooms)
                    .filter(([, room]) => room.isPublic && !room.client)
                    .map(([code, room]) => ({ code, name: room.name, hasPassword: !!room.password }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: publicRooms }));
                break;
            }

            // --- WebRTC Signaling ---
            // These messages are just forwarded to the other client in the room
            case 'offer':
            case 'answer':
            case 'ice_candidate': {
                const room = rooms[roomCode];
                if (room) {
                    const target = ws === room.host ? room.client : room.host;
                    if (target) {
                        target.send(JSON.stringify({ type, sdp, candidate }));
                    }
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        const roomCode = ws.roomCode;
        if (roomCode && rooms[roomCode]) {
            const room = rooms[roomCode];
            const isHost = ws === room.host;

            // Notify the other player
            const otherPlayer = isHost ? room.client : room.host;
            if (otherPlayer && otherPlayer.readyState === otherPlayer.OPEN) {
                otherPlayer.send(JSON.stringify({ type: 'opponent_left' }));
            }

            // Clean up the room
            console.log(`Closing room: ${roomCode}`);
            delete rooms[roomCode];
            broadcastRoomsList();
        }
    });
});

function broadcastRoomsList() {
    const publicRooms = Object.entries(rooms)
        .filter(([, room]) => room.isPublic && !room.client)
        .map(([code, room]) => ({ code, name: room.name, hasPassword: !!room.password }));

    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN && !client.roomCode) { // Only send to clients in the lobby
            client.send(JSON.stringify({ type: 'rooms_list', rooms: publicRooms }));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
});
