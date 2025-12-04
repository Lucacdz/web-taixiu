const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== Data tạm trong RAM =====
const users = {}; // { username: { password, money } }
let players = {}; // { socket.id: { username, money, auto, hasBet } }
let currentBets = {}; // { socket.id: { type, amount } }
let chatHistory = [];
let roundHistory = [];
let recentWins = [];

const ROUND_TIME = 30; // giây đặt cược
const BREAK_TIME = 30; // giây nghỉ giữa vòng
let currentTime = ROUND_TIME;
let inBreak = false;

// ===== Routes =====
app.post("/register", (req,res)=>{
    const { username, password } = req.body;
    if(users[username]) return res.json({ success:false, msg:"Tên đã tồn tại" });
    users[username] = { password, money:10000 };
    return res.json({ success:true, msg:"Đăng ký thành công", money:10000 });
});

app.post("/login", (req,res)=>{
    const { username, password } = req.body;
    if(!users[username] || users[username].password !== password)
        return res.json({ success:false, msg:"Sai tên hoặc mật khẩu" });
    return res.json({ success:true, msg:"Đăng nhập thành công", money:users[username].money });
});

// ===== Socket.io =====
io.on("connection", socket=>{
    console.log("Player connected:", socket.id);

    socket.on("player_login", data=>{
        const username = data.username;
        if(!users[username]) return;
        players[socket.id] = { username, money:users[username].money, auto:false, hasBet:false };
        socket.emit("update_player", players[socket.id]);
        socket.emit("chat_history", chatHistory.slice(-50));
        socket.emit("round_history", roundHistory);
        socket.emit("top_wins", recentWins);
    });

    socket.on("bet", data=>{
        if(!players[socket.id]) return;
        if(players[socket.id].hasBet){
            socket.emit("bet_error","Bạn đã đặt cược cho vòng này");
            return;
        }
        if(inBreak){
            socket.emit("bet_error","Đang nghỉ giữa vòng, không thể cược!");
            return;
        }

        let amount = parseInt(data.amount);
        if(players[socket.id].money < amount){
            socket.emit("bet_error","Bạn không đủ tiền để đặt cược!");
            return;
        }

        currentBets[socket.id] = { type:data.type, amount };
        players[socket.id].auto = data.auto || false;
        players[socket.id].hasBet = true;
        io.emit("bet_update", currentBets);
        socket.emit("bet_locked");
    });

    socket.on("chat", msg=>{
        if(!players[socket.id]) return;
        const chat = { username: players[socket.id].username, msg };
        chatHistory.push(chat);
        io.emit("chat_history", chatHistory.slice(-50));
    });

    socket.on("disconnect", ()=>{
        delete currentBets[socket.id];
        delete players[socket.id];
        io.emit("bet_update", currentBets);
    });
});

// ===== Countdown & Auto roll dice =====
setInterval(()=>{
    if(Object.keys(players).length===0) return;

    currentTime--;
    io.emit("timer_update", currentTime, inBreak);

    if(currentTime <= 0){
        if(!inBreak){
            // Kết thúc vòng, tính kết quả
            function rollDice(){ return [
                Math.floor(Math.random()*6)+1,
                Math.floor(Math.random()*6)+1,
                Math.floor(Math.random()*6)+1
            ];}

            let result = rollDice();
            let sum = result.reduce((a,b)=>a+b,0);
            let outcome = sum>=11?"Tài":"Xỉu";

            let roundWins = [];

            for(let id in currentBets){
                if(!players[id]) continue;
                let bet = currentBets[id];
                let player = players[id];
                let winAmount = 0;
                if(bet.type === outcome){
                    player.money += bet.amount;
                    winAmount = bet.amount;
                } else {
                    player.money -= bet.amount;
                }

                // Cập nhật RAM
                users[player.username].money = player.money;

                if(winAmount > 0){
                    roundWins.push({ username: player.username, win: winAmount });
                }

                player.hasBet = false;
            }

            recentWins = recentWins.concat(roundWins);
            if(recentWins.length > 10) recentWins = recentWins.slice(-10);

            roundHistory.push({ result, outcome });
            if(roundHistory.length > 10) roundHistory.shift();

            io.emit("round_result", { result, outcome, bets:currentBets, players });
            io.emit("round_history", roundHistory);
            io.emit("top_wins", recentWins);

            currentBets = {};
            currentTime = BREAK_TIME; // bắt đầu nghỉ giữa vòng
            inBreak = true;
        } else {
            // Kết thúc break, bắt đầu vòng mới
            currentTime = ROUND_TIME;
            inBreak = false;
            io.emit("new_round"); // thông báo bắt đầu vòng mới
        }
    }
}, 1000);

// ===== Nhạc nền =====
io.on("connection", socket=>{
    socket.emit("music_url", "https://files.catbox.moe/sbvh44.mp3"); // link nhạc
});

http.listen(PORT, ()=>console.log(`Server chạy http://localhost:${PORT}`));