const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let users = {};
try { users = JSON.parse(fs.readFileSync("users.json")); } catch(e){}

function saveUsers(){ fs.writeFileSync("users.json", JSON.stringify(users,null,2)); }

let currentBets = {};
let players = {};
let chatHistory = [];

const ROUND_TIME = 30;
let currentTime = ROUND_TIME;

// ===== Routes =====
app.post("/register", (req,res)=>{
    const { username, password } = req.body;
    if(users[username]) return res.json({ success:false, msg:"Tên đã tồn tại" });
    users[username] = { password, money:10000 };
    saveUsers();
    return res.json({ success:true, msg:"Đăng ký thành công", money:10000 });
});

app.post("/login", (req,res)=>{
    const { username, password } = req.body;
    if(!users[username] || users[username].password !== password)
        return res.json({ success:false, msg:"Sai tên hoặc mật khẩu" });
    return res.json({ success:true, msg:"Đăng nhập thành công", money: users[username].money });
});

// ===== Socket.io =====
io.on("connection", socket=>{
    console.log("Player connected:", socket.id);

    socket.on("player_login", data=>{
        players[socket.id] = { username: data.username, money: users[data.username].money, auto:false, hasBet:false };
        socket.emit("update_player", players[socket.id]);
        socket.emit("chat_history", chatHistory.slice(-50));
    });

    socket.on("bet", data=>{
        if(!players[socket.id]) return;
        if(players[socket.id].hasBet){
            socket.emit("bet_error","Bạn đã đặt cược cho vòng này");
            return;
        }

        let amount = parseInt(data.amount);
        if(players[socket.id].money < amount){
            socket.emit("bet_error","Không đủ tiền");
            return;
        }

        currentBets[socket.id] = { type:data.type, amount };
        players[socket.id].auto = data.auto || false;
        players[socket.id].hasBet = true;
        io.emit("bet_update", currentBets);
        socket.emit("bet_locked"); // khoá nút lựa chọn
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
    io.emit("timer_update", currentTime);

    if(currentTime <= 0){
        function rollDice(){ return [
            Math.floor(Math.random()*6)+1,
            Math.floor(Math.random()*6)+1,
            Math.floor(Math.random()*6)+1
        ];}

        let result = rollDice();
        let sum = result.reduce((a,b)=>a+b,0);
        let outcome = sum>=11?"Tài":"Xỉu";

        for(let id in currentBets){
            if(!players[id]) continue;
            let bet = currentBets[id];
            let player = players[id];
            if(bet.type === outcome) player.money += bet.amount;
            else player.money -= bet.amount;
            users[player.username].money = player.money;
            player.hasBet = false; // mở khoá cho vòng tiếp theo
        }
        saveUsers();

        io.emit("round_result", { result, outcome, bets:currentBets, players });
        currentBets = {};
        currentTime = ROUND_TIME;
    }
}, 1000);

http.listen(PORT, ()=>console.log(`Server chạy http://localhost:${PORT}`));