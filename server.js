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

io.on("connection", socket=>{
    console.log("Player connected:", socket.id);

    socket.on("player_login", data=>{
        players[socket.id] = { username: data.username, money: users[data.username].money, auto:false };
        socket.emit("update_player", players[socket.id]);
        io.emit("chat_history", chatHistory);
    });

    socket.on("bet", data=>{
        if(!players[socket.id]) return;
        let amount = parseInt(data.amount);
        if(players[socket.id].money < amount){
            socket.emit("bet_error","Không đủ tiền");
            return;
        }
        currentBets[socket.id] = { type:data.type, amount };
        players[socket.id].auto = data.auto || false;
        io.emit("bet_update", currentBets);
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

setInterval(()=>{
    if(Object.keys(currentBets).length===0) return;

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
    }
    saveUsers();

    io.emit("round_result", { result, outcome, bets:currentBets, players });
    currentBets = {};
}, 30000);

http.listen(PORT, ()=>console.log(`Server chạy http://localhost:${PORT}`));