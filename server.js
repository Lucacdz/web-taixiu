const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let players = {}; // { socketId: {name, money, history: []} }
let currentBets = {}; // { socketId: {type, amount} }

// Hàm mở bát
function rollDice() {
    let d1 = Math.floor(Math.random() * 6) + 1;
    let d2 = Math.floor(Math.random() * 6) + 1;
    let d3 = Math.floor(Math.random() * 6) + 1;
    let sum = d1 + d2 + d3;
    let outcome = sum >= 11 ? "Tài" : "Xỉu";
    return { d1, d2, d3, sum, outcome };
}

// Mở bát mỗi 15 giây
setInterval(() => {
    if(Object.keys(currentBets).length === 0) return;

    let result = rollDice();

    // Tính tiền thắng thua
    for (let id in currentBets) {
        if (!players[id]) continue;
        let bet = currentBets[id];
        let win = bet.type === result.outcome;
        let amount = bet.amount || 100; // mặc định 100 xu
        if (win) players[id].money += amount;
        else players[id].money -= amount;

        // Lưu lịch sử
        players[id].history.push({ bet: bet.type, result: result.outcome, win, amount });
    }

    // Thông báo kết quả cho tất cả
    io.emit("result", { result, bets: currentBets, players });

    // Reset cược
    currentBets = {};
}, 15000);

io.on("connection", socket => {
    console.log("Player joined:", socket.id);

    const name = socket.handshake.query.name || socket.id;

    // Khởi tạo người chơi
    if(!players[socket.id]) players[socket.id] = { name, money: 1000, history: [] };

    socket.emit("update_player", players[socket.id]);

    socket.on("bet", data => {
        if(!players[socket.id]) return;
        currentBets[socket.id] = { type: data.type, amount: data.amount || 100 };
        io.emit("bet_update", currentBets);
    });

    socket.on("disconnect", () => {
        delete currentBets[socket.id];
        io.emit("bet_update", currentBets);
    });
});

http.listen(PORT, () => {
    console.log(`Server chạy tại http://localhost:${PORT}`);
});