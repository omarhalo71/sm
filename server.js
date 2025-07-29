// تكوين Socket.IO للعمل مع Render.com
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// إنشاء تطبيق Express
const app = express();

// تمكين CORS لجميع الطلبات
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// إنشاء خادم HTTP
const server = http.createServer(app);

// إعداد Socket.IO مع خيارات CORS المناسبة
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  allowEIO3: true // للتوافق مع الإصدارات القديمة من العملاء
});

// متغيرات لتخزين حالة المستخدمين والمكالمات
let users = {}; // { userId: socketId, ... }
let activeCalls = {}; // { userId: otherUserId, ... } - Stores active call pairs
let groupMembers = {}; // { groupId: [userId1, userId2, ...], ... }

// معالجة اتصال العميل
io.on("connection", socket => {
  console.log("🟢 مستخدم متصل:", socket.id);
socket.on("joinGroup", ({ group_id, user_id }) => {
  if (!groupMembers[group_id]) groupMembers[group_id] = [];
  if (!groupMembers[group_id].includes(user_id)) {
    groupMembers[group_id].push(user_id);
    console.log(`👥 المستخدم ${user_id} انضم للمجموعة ${group_id}`);
  }
});

  // تسجيل المستخدم عند الاتصال
  socket.on("registerUser", userID => {
    // تنظيف البيانات القديمة للمستخدم إذا كان متصلاً سابقاً بنفس المعرف
    Object.keys(users).forEach(key => {
      if (users[key] === socket.id && key !== String(userID)) {
        // If this socket ID was previously associated with a different user ID, remove old entry
        delete users[key];
      }
    });
    // If this user ID was previously associated with a different socket ID, remove old entry
    if (users[userID] && users[userID] !== socket.id) {
        console.log(`🔄 تحديث معرف المقبس للمستخدم ${userID} من ${users[userID]} إلى ${socket.id}`);
    }

    // تسجيل المستخدم الجديد أو تحديث معرف المقبس
    users[userID] = socket.id;
    console.log(`📌 المستخدم ${userID} تم تسجيله/تحديثه. المتصلين حاليًا:`, Object.keys(users).length);
    console.log(users); // Log the users object for debugging

    // إرسال قائمة المستخدمين المتصلين للعميل الحالي
    socket.emit("onlineUsers", Object.keys(users).map(Number)); // Send as array of numbers

    // إعلام جميع المستخدمين الآخرين بالمستخدم الجديد المتصل
    socket.broadcast.emit("userConnected", userID);
  });

  // طلب قائمة المستخدمين المتصلين
  socket.on("getOnlineUsers", () => {
      socket.emit("onlineUsers", Object.keys(users).map(Number));
  });

  // معالجة قطع الاتصال
  socket.on("disconnect", () => {
    console.log("🔴 المستخدم قطع الاتصال:", socket.id);

    let disconnectedUser = null;

    // البحث عن المستخدم الذي قطع الاتصال
    Object.keys(users).forEach(userID => {
      if (users[userID] === socket.id) {
        disconnectedUser = userID;
        console.log(`🚪 خروج المستخدم ${userID}`);
        delete users[userID];

        // إذا كان في مكالمة، بلغ الطرف الثاني
        // Note: This simple activeCalls structure might not be robust for group calls or complex scenarios
        Object.keys(activeCalls).forEach(callerId => {
            if (activeCalls[callerId] === disconnectedUser) {
                const otherUser = callerId;
                if (users[otherUser]) {
                    io.to(users[otherUser]).emit("endCall", { from: disconnectedUser, reason: "disconnected" });
                }
                delete activeCalls[otherUser]; // Remove both entries
                delete activeCalls[disconnectedUser];
            } else if (callerId === disconnectedUser) {
                 const otherUser = activeCalls[callerId];
                 if (users[otherUser]) {
                    io.to(users[otherUser]).emit("endCall", { from: disconnectedUser, reason: "disconnected" });
                }
                delete activeCalls[otherUser]; // Remove both entries
                delete activeCalls[disconnectedUser];
            }
        });
      }
    });

    // إعلام جميع المستخدمين بخروج المستخدم
    if (disconnectedUser) {
      io.emit("userDisconnected", disconnectedUser);
      console.log("📉 المستخدمين المتبقين:", Object.keys(users).length);
    }
  });

  // --- Messaging Events ---

  // إرسال رسالة
  socket.on("sendMessage", ({ to, from, message, type = 'text', temp_id, timestamp }) => {
    console.log(`💬 رسالة ${type} من ${from} إلى ${to}: ${type === 'text' ? message.substring(0, 20) + '...' : `[${type}]`}`);

    // Here you would typically save the message to the database
    // For now, we just forward it and confirm

    const messageData = {
        from,
        message,
        type,
        created_at: timestamp || new Date().toISOString(),
        // Ideally, the real message_id comes from the database save operation
        message_id: Date.now() // Use timestamp as a temporary unique ID for example
    };

    // إرسال الرسالة إلى المستلم إذا كان متصلاً
    if (users[to]) {
      io.to(users[to]).emit("newMessage", messageData);
      console.log(`📤 تم إرسال الرسالة إلى ${to}`);
    } else {
      console.log(`📪 المستخدم ${to} غير متصل، سيتم تسليم الرسالة لاحقًا.`);
      // Logic for offline message handling (e.g., push notifications) would go here
    }

    // إرسال تأكيد استلام إلى المرسل مع معرف الرسالة المؤقت والحقيقي
    socket.emit("messageSent", {
      to,
      message,
      type,
      temp_id, // Include the temp_id sent by the client
      message_id: messageData.message_id, // Include the real (or temporary real) message ID
      created_at: messageData.created_at
    });
  });
// الحدث sendGroupMessage يجب أن يكون هنا بشكل مستقل
socket.on("sendGroupMessage", ({ group_id, from, message, type = 'text', temp_id, timestamp }) => {
  console.log(`💬 رسالة مجموعة ${group_id} من ${from}: ${type === 'text' ? message.substring(0, 20) + '...' : `[${type}]`}`);

  const messageData = {
    group_id,
    from,
    message,
    type,
    created_at: timestamp || new Date().toISOString(),
    message_id: Date.now()
  };

  if (groupMembers[group_id]) {
    groupMembers[group_id].forEach(userId => {
      if (userId != from && users[userId]) {
        io.to(users[userId]).emit("newGroupMessage", messageData);
      }
    });
  }

  socket.emit("groupMessageSent", {
    group_id,
    message,
    type,
    temp_id,
    message_id: messageData.message_id,
    created_at: messageData.created_at
  });
});
  // إشعار بالكتابة
  socket.on("typing", ({ to, from, isTyping }) => {
    if (users[to]) {
      io.to(users[to]).emit("userTyping", {
        from,
        isTyping
      });
    }
  });

  // إشعار بقراءة الرسائل
  socket.on("markAsRead", ({ to, from, messageIds }) => {
    // Here you would update the message status in the database
    console.log(`👀 المستخدم ${from} قرأ الرسائل من ${to}:`, messageIds);
    if (users[to]) {
      io.to(users[to]).emit("messagesRead", {
        from,
        messageIds
      });
    }
  });

  // --- Call Events ---

  // Listen for call initiation (Corrected event name)
  socket.on("startCall", ({ to, from, callType, callerName }) => {
    console.log(`📞 المستخدم ${from} (${callerName}) يبدأ اتصال ${callType} مع ${to}`);

    if (users[to]) { // Check if recipient is online
      // Emit incomingCall to the recipient's socket ID
      io.to(users[to]).emit("incomingCall", {
        from,
        callType,
        callerName // Pass callerName to the recipient
      });
      console.log(`🔔 إرسال إشعار مكالمة واردة إلى ${to} (Socket ID: ${users[to]})`);

      // Note: activeCalls might need more robust handling for multiple calls/missed calls
      // For simplicity, we just note the attempt. Call state is managed more on call.php

    } else {
      // If the user is offline, notify the caller
      console.log(`❌ فشل الاتصال: المستخدم ${to} غير متصل.`);
      socket.emit("callFailed", {
        userToCall: to,
        reason: "user_offline"
      });
    }
  });

  // رفض المكالمة (Sent by recipient)
  socket.on("rejectCall", ({ to, from }) => { // 'to' is the original caller, 'from' is the recipient rejecting
    if (users[to]) {
      console.log(`❌ المستخدم ${from} رفض المكالمة من ${to}.`);
      io.to(users[to]).emit("callRejected", { from });
    }
  });

  // قبول المكالمة (Sent by recipient, includes their signal)
  socket.on("answerCall", ({ to, from, signal }) => { // 'to' is the original caller, 'from' is the recipient answering
    if (users[to]) {
      console.log(`✅ المستخدم ${from} قبل المكالمة من ${to}`);
      io.to(users[to]).emit("callAccepted", { from, signal });
      // Mark call as active between the two
      activeCalls[from] = to;
      activeCalls[to] = from;
    }
  });

  // تمرير إشارات WebRTC (ICE Candidates, SDP offers/answers if needed beyond initial)
  socket.on("signal", ({ to, from, signal }) => {
    if (users[to]) {
      // Forward the signal data (could be offer, answer, or ICE candidate)
      io.to(users[to]).emit("signal", { from, signal });
    } else {
        console.log(`⚠️ لا يمكن إرسال إشارة إلى ${to} (غير متصل)`);
    }
  });

  // إنهاء المكالمة (Sent by either party)
  socket.on("endCall", ({ to, from }) => { // 'from' is the user ending the call, 'to' is the other party
    console.log(`📴 إنهاء المكالمة بين ${from} و ${to}`);

    // Notify the other party if they are online
    if (users[to]) {
        io.to(users[to]).emit("endCall", { from, reason: "hangup" });
    }
    // Optionally notify the sender too, for UI cleanup
    if (users[from]) {
        io.to(users[from]).emit("endCall", { from, reason: "hangup" });
    }

    // حذف المكالمة من قائمة المكالمات النشطة
    delete activeCalls[from];
    delete activeCalls[to];
  });

  // Note: Removed "saveCallLog" event as it tried to use Axios on the server-side incorrectly.
  // Call logging should be handled by the client (call.php) sending a regular message after the call ends.

});

// طريق بسيط للتحقق من حالة الخادم
app.get("/status", (req, res) => {
  res.json({
    status: "online",
    connections: Object.keys(users).length,
    activeCalls: Object.keys(activeCalls).length / 2 // Each call involves two users
  });
});

// استخدام المنفذ الذي توفره Render.com أو المنفذ 5000 كاحتياطي
const PORT = process.env.PORT || 5000;

// بدء الاستماع على المنفذ المحدد
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 السيرفر شغال على http://0.0.0.0:${PORT}`);
});

// تصدير التطبيق لاستخدامه مع Render.com (if needed for specific deployment setups)
// module.exports = app;

