const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const bodyParser = require("body-parser");
const { MongoClient, ServerApiVersion } = require("mongodb");
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== MongoDB =====
const uri = "mongodb+srv://<Ngduyanh>:<cuto>@cluster0.mongodb.net/taixiu?retryWrites=true&w=majority";
// Thay thế <username> và <password> bằng thông tin thật của bạn
// Hoặc sử dụng MongoDB local:
// const uri = "mongodb://localhost:27017/taixiu";

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let usersCollection;

async function initMongo(){
    try {
        await client.connect();
        console.log("✅ Đã kết nối MongoDB");
        const db = client.db("taixiu");
        usersCollection = db.collection("users");
        
        // Tạo index cho username
        await usersCollection.createIndex({ username: 1 }, { unique: true });
    } catch (err) {
        console.error("❌ Lỗi kết nối MongoDB:", err);
    }
}
initMongo();

// ===== Game variables =====
let currentBets = {};
let players = {};
let chatHistory = [];
let roundHistory = [];
let recentWins = [];
const ROUND_TIME = 30; // thời gian đặt cược
const BREAK_TIME = 30; // thời gian nghỉ giữa vòng
let currentTime = ROUND_TIME;
let inBreak = false;

// ===== Routes =====
app.post("/register", async (req,res)=>{
    try {
        const { username, password } = req.body;
        
        if(!username || !password) {
            return res.json({ success:false, msg:"Vui lòng nhập đầy đủ thông tin" });
        }
        
        const existing = await usersCollection.findOne({ username });
        if(existing) return res.json({ success:false, msg:"Tên đã tồn tại" });
        
        await usersCollection.insertOne({ 
            username, 
            password, 
            money: 1000000, // 1 triệu xu ban đầu
            createdAt: new Date(),
            totalBets: 0,
            totalWins: 0
        });
        
        return res.json({ 
            success:true, 
            msg:"Đăng ký thành công! Bạn có 1,000,000 xu", 
            money: 1000000 
        });
    } catch (err) {
        console.error("Lỗi đăng ký:", err);
        return res.json({ success:false, msg:"Lỗi hệ thống" });
    }
});

app.post("/login", async (req,res)=>{
    try {
        const { username, password } = req.body;
        
        if(!username || !password) {
            return res.json({ success:false, msg:"Vui lòng nhập đầy đủ thông tin" });
        }
        
        const user = await usersCollection.findOne({ username });
        if(!user || user.password !== password) {
            return res.json({ success:false, msg:"Sai tên hoặc mật khẩu" });
        }
        
        return res.json({ 
            success:true, 
            msg:`Chào mừng ${username} trở lại!`,
            money: user.money,
            totalBets: user.totalBets || 0,
            totalWins: user.totalWins || 0
        });
    } catch (err) {
        console.error("Lỗi đăng nhập:", err);
        return res.json({ success:false, msg:"Lỗi hệ thống" });
    }
});

// Route để lấy thông tin user
app.get("/user/:username", async (req,res)=>{
    try {
        const user = await usersCollection.findOne({ 
            username: req.params.username 
        });
        
        if(!user) return res.json({ success:false, msg:"Không tìm thấy user" });
        
        res.json({
            success: true,
            username: user.username,
            money: user.money,
            totalBets: user.totalBets || 0,
            totalWins: user.totalWins || 0,
            createdAt: user.createdAt
        });
    } catch (err) {
        res.json({ success:false, msg:"Lỗi hệ thống" });
    }
});

// ===== Socket.io =====
io.on("connection", socket=>{
    console.log("🎮 Player connected:", socket.id);

    socket.on("player_login", async data=>{
        try {
            const user = await usersCollection.findOne({ username: data.username });
            if(!user) return;
            
            players[socket.id] = { 
                username: data.username, 
                money: user.money, 
                auto: false, 
                hasBet: false,
                totalBets: user.totalBets || 0,
                totalWins: user.totalWins || 0
            };
            
            socket.emit("update_player", players[socket.id]);
            socket.emit("chat_history", chatHistory.slice(-50));
            socket.emit("round_history", roundHistory);
            socket.emit("top_wins", recentWins);
            
            // Thông báo có người mới vào
            const welcomeMsg = {
                username: "📢 HỆ THỐNG",
                msg: `🎉 Chào mừng ${data.username} tham gia game!`
            };
            chatHistory.push(welcomeMsg);
            io.emit("chat_history", chatHistory.slice(-50));
        } catch (err) {
            console.error("Lỗi player_login:", err);
        }
    });

    socket.on("bet", async data=>{
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

        if(amount < 5000){
            socket.emit("bet_error","Mức cược tối thiểu là 5,000 xu!");
            return;
        }

        currentBets[socket.id] = { 
            type: data.type, 
            amount,
            username: players[socket.id].username 
        };
        players[socket.id].auto = data.auto || false;
        players[socket.id].hasBet = true;
        
        // Cập nhật tổng số cược
        players[socket.id].totalBets = (players[socket.id].totalBets || 0) + 1;
        
        io.emit("bet_update", currentBets);
        socket.emit("bet_locked");
        
        // Thông báo chat về cược
        const betMsg = {
            username: "🎲 CƯỢC",
            msg: `${players[socket.id].username} đặt ${data.type} ${amount.toLocaleString()} xu!`
        };
        chatHistory.push(betMsg);
        io.emit("chat_history", chatHistory.slice(-50));
    });

    socket.on("chat", msg=>{
        if(!players[socket.id]) return;
        
        const chat = { 
            username: players[socket.id].username, 
            msg,
            timestamp: new Date()
        };
        chatHistory.push(chat);
        io.emit("chat_history", chatHistory.slice(-50));
    });

    socket.on("disconnect", ()=>{
        if(players[socket.id]) {
            const leaveMsg = {
                username: "📢 HỆ THỐNG",
                msg: `${players[socket.id].username} đã rời game`
            };
            chatHistory.push(leaveMsg);
            io.emit("chat_history", chatHistory.slice(-50));
        }
        
        delete currentBets[socket.id];
        delete players[socket.id];
        io.emit("bet_update", currentBets);
        console.log("👋 Player disconnected:", socket.id);
    });
});

// ===== Countdown & Auto roll dice =====
setInterval(async ()=>{
    if(Object.keys(players).length===0) return;

    currentTime--;
    io.emit("timer_update", currentTime, inBreak);

    if(currentTime <= 0){
        if(!inBreak){
            // Kết thúc vòng, tính kết quả
            function rollDice(){ 
                return [
                    Math.floor(Math.random()*6)+1,
                    Math.floor(Math.random()*6)+1,
                    Math.floor(Math.random()*6)+1
                ];
            }

            let result = rollDice();
            let sum = result.reduce((a,b)=>a+b,0);
            let outcome = sum>=11?"Tài":"Xỉu";
            
            // Thêm tổng vào kết quả
            outcome = `${outcome} (${sum} điểm)`;

            let roundWins = [];

            // Tính toán kết quả cho từng người chơi
            for(let id in currentBets){
                if(!players[id]) continue;
                
                let bet = currentBets[id];
                let player = players[id];
                let winAmount = 0;
                
                if(bet.type === outcome.split(" ")[0]){ // Chỉ so sánh "Tài" hoặc "Xỉu"
                    player.money += bet.amount;
                    winAmount = bet.amount;
                    player.totalWins = (player.totalWins || 0) + 1;
                    
                    // Thêm vào top wins
                    roundWins.push({ 
                        username: player.username, 
                        win: winAmount,
                        time: new Date()
                    });
                } else {
                    player.money -= bet.amount;
                }

                // Cập nhật vào database
                await usersCollection.updateOne(
                    { username: player.username },
                    { $set: { 
                        money: player.money,
                        totalBets: player.totalBets,
                        totalWins: player.totalWins
                    }}
                );

                player.hasBet = false;
                
                // Nếu auto bet, tự động đặt cược tiếp
                if(player.auto && player.money >= parseInt(document.getElementById("bet_amount")?.value || 5000)){
                    currentBets[id] = { 
                        type: Math.random() > 0.5 ? "Tài" : "Xỉu",
                        amount: parseInt(document.getElementById("bet_amount")?.value || 5000),
                        username: player.username
                    };
                    player.hasBet = true;
                }
            }

            // Cập nhật recent wins
            recentWins = recentWins.concat(roundWins);
            // Sắp xếp theo số tiền thắng
            recentWins.sort((a,b) => b.win - a.win);
            if(recentWins.length > 10) recentWins = recentWins.slice(0, 10);

            // Lưu lịch sử vòng
            roundHistory.push({ result, outcome });
            if(roundHistory.length > 10) roundHistory.shift();

            // Gửi kết quả cho tất cả người chơi
            io.emit("round_result", { 
                result, 
                outcome, 
                bets: currentBets, 
                players,
                roundWins 
            });
            io.emit("round_history", roundHistory);
            io.emit("top_wins", recentWins);
            
            // Thông báo kết quả trong chat
            const diceEmoji = ["","⚀","⚁","⚂","⚃","⚄","⚅"];
            const diceStr = result.map(d => diceEmoji[d]).join(" ");
            const resultMsg = {
                username: "🎯 KẾT QUẢ",
                msg: `Xúc xắc: ${diceStr} → ${outcome}`
            };
            chatHistory.push(resultMsg);
            io.emit("chat_history", chatHistory.slice(-50));

            currentBets = {};
            currentTime = BREAK_TIME;
            inBreak = true;
        } else {
            // Kết thúc break, bắt đầu vòng mới
            currentTime = ROUND_TIME;
            inBreak = false;
            io.emit("new_round");
            
            // Thông báo vòng mới
            const newRoundMsg = {
                username: "🔄 VÒNG MỚI",
                msg: "Vòng đặt cược mới bắt đầu! Chuẩn bị đặt cược!"
            };
            chatHistory.push(newRoundMsg);
            io.emit("chat_history", chatHistory.slice(-50));
        }
    }
}, 1000);

// Xóa chat cũ mỗi giờ
setInterval(() => {
    if(chatHistory.length > 1000){
        chatHistory = chatHistory.slice(-500);
        console.log("🧹 Đã dọn dẹp chat history");
    }
}, 3600000);

http.listen(PORT, ()=>{
    console.log(`🎮 Server đang chạy tại http://localhost:${PORT}`);
    console.log(`🎵 Nhạc nền game đã sẵn sàng`);
    console.log(`⚡ Kết nối Socket.IO đã bật`);
});