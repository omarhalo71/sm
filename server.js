const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
app.use(express.json());
const server = http.createServer(app); // ✅ هذا السطر مهم!
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// بقية كود socket.io



// ✅ شغّل السيرفر على الشبكة كلها:
server.listen(5000, "0.0.0.0", () => {
  console.log("🚀 السيرفر شغال على http://0.0.0.0:5000");
});


let users = {}; // قائمة المستخدمين المتصلين
let activeCalls = {}; // قائمة المكالمات النشطة


io.on("connection", socket => {
  const axios = require("axios");

socket.on("saveCallLog", ({ from, to, duration, type }) => {
    const minutes = String(Math.floor(duration / 60)).padStart(2, "0");
    const seconds = String(duration % 60).padStart(2, "0");
    const formatted = `${minutes}:${seconds}`;
    const msg = `📞 تمت مكالمة ${type === "video" ? "فيديو" : "صوتية"} مدتها ${formatted}`;

    axios.post("https://halostl.com/social_media/send_call_message.php", {

        from,
        to,
        message: msg
    }).then(() => {
        console.log("✅ تم إرسال رسالة المكالمة إلى المستخدم", to);
    }).catch(err => {
        console.error("🚨 فشل في إرسال رسالة المكالمة:", err.message);
    });
});

    console.log("🟢 مستخدم متصل:", socket.id);

    // ✅ تسجيل المستخدم عند الاتصال
    socket.on("registerUser", userID => {
        users[userID] = socket.id;
        console.log(`📌 المستخدم ${userID} تم تسجيله. المتصلين حاليًا:`, users);
    });
    
    socket.on("disconnect", () => {
      console.log("🔴 المستخدم قطع الاتصال:", socket.id);
    
      Object.keys(users).forEach(userID => {
        if (users[userID] === socket.id) {
          console.log(`🚪 خروج المستخدم ${userID}`);
          delete users[userID];
    
          // إذا كان في مكالمة، بلغ الطرف الثاني
          if (activeCalls[userID]) {
            const otherUser = activeCalls[userID];
            if (users[otherUser]) {
              io.to(users[otherUser]).emit("endCall");
            }
            delete activeCalls[otherUser];
            delete activeCalls[userID];
          }
        }
      });
    });
    
    
    

    // ✅ إرسال طلب اتصال
    socket.on("callUser", ({ userToCall, from, signal }) => {
      console.log(`📞 المستخدم ${from} يتصل بـ ${userToCall}`);
      if (users[userToCall]) {
        io.to(users[userToCall]).emit("incomingCall", { from, signal });
    
        // 🟢 تسجيل المكالمة النشطة
        activeCalls[from] = userToCall;
        activeCalls[userToCall] = from;
      }
    });
    
    

    // ✅ الرد على الاتصال
    socket.on("answerCall", ({ to, signal }) => {
        if (users[to]) {
            console.log(`✅ المستخدم ${to} قبل المكالمة مع ${activeCalls[to]}`);
            io.to(users[to]).emit("callAccepted", { signal });
        }
    });

    // ✅ تمرير `ICE Candidates`
    socket.on("iceCandidate", ({ to, candidate }) => {
        if (users[to]) {
            console.log(`🧊 تمرير ICE Candidate إلى ${to}:`, candidate);
            io.to(users[to]).emit("iceCandidate", { candidate });
        }
    });
    
    

    // ✅ إنهاء المكالمة
    socket.on("endCall", ({ from, to }) => {
        console.log(`📴 إنهاء المكالمة بين ${from} و ${to}`);
    
        // إنهاء المكالمة عند الطرفين
        if (users[to]) io.to(users[to]).emit("endCall");
        if (users[from]) io.to(users[from]).emit("endCall");
    
        delete activeCalls[from];
        delete activeCalls[to];
    });
    

    // ✅ رفض المكالمة
    socket.on("rejectCall", ({ to }) => {
        if (users[to]) {
            console.log(`❌ المستخدم ${to} رفض المكالمة.`);
            io.to(users[to]).emit("callRejected");
        }
    });

    // ✅ تسجيل خروج المستخدم عند قطع الاتصال
    socket.on("updateUserStatus", (data) => {
    // فقط نرسل لباقي المستخدمين عن حالة هاد المستخدم
    io.emit("updateUserStatus", {
        userId: data.userId,
        status: data.status
    });
    console.log("📶 تحديث حالة المستخدم:", data.userId, "->", data.status);
});

});

