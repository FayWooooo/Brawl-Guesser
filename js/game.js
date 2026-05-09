(function() {
    // --- [ 1. 初始化與變數定義 ] ---
    const SUPABASE_URL = 'https://wvnencbfkbjvszsgamdq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqdnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: true, storageKey: 'brawl-guesser-auth' }
        });
    }

    let currentVideo = null;
    let currentUser = null;
    let isInitialized = false;
    let targetQuests = 5; 
    let currentQuestCount = 0;
    let currentBlobUrl = null; // 用於管理臨時網址

    const videoElem = document.getElementById('game-video');
    const quizOverlay = document.getElementById('quiz-overlay');
    const videoContainer = document.querySelector('.video-container');

    // --- [ 2. 加密載入邏輯 (Blob URL) ] ---
    // --- [ 核心：加密下載並禁止右鍵 ] ---
async function secureLoadVideo(path) {
    try {
        // 1. 下載影片數據 (這會消耗流量但能完全隱藏原始連結)
        const { data, error } = await window.supabaseClient.storage.from('videos').download(path);
        
        if (error) throw error;

        // 2. 建立 Blob URL
        // 這個 URL 格式為 blob:https://yourdomain.com/uuid
        // 特性：離開此頁面即失效，開新分頁會出現 404
        const newBlobUrl = URL.createObjectURL(data);
        
        if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = newBlobUrl;

        videoElem.src = currentBlobUrl;
        
        // 3. 移除影片控制項
        videoElem.controls = false; 
        videoElem.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
        videoElem.disablePictureInPicture = true; // 禁止子母畫面

        videoElem.load();
        videoElem.play();

    } catch (err) {
        console.error("安全載入失敗:", err);
    }
}

// --- [ 全域防護：禁止右鍵與快捷鍵 ] ---
// 禁止右鍵選單 (防止另存影片)
document.addEventListener('contextmenu', e => {
    if (e.target.nodeName === 'VIDEO') e.preventDefault();
}, false);

// 防止按下空格鍵或 F12 等控制 (選做)
window.addEventListener('keydown', e => {
    // 禁止空格暫停 (Space)
    if (e.keyCode === 32 && e.target === document.body) {
        e.preventDefault();
    }
});

    // --- [ 3. 遊戲流程控制 ] ---
    window.renderQuestMenu = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2 style="margin-bottom:20px;">選擇挑戰題數</h2>
                <div class="options-grid">
                    <button class="option-btn" onclick="window.startChallenge(3)">3 題</button>
                    <button class="option-btn" onclick="window.startChallenge(5)">5 題</button>
                    <button class="option-btn" onclick="window.startChallenge(10)">10 題</button>
                </div>
            </div>`;
        quizOverlay.style.display = 'flex';
    };

    window.startChallenge = function(num) {
        targetQuests = num;
        currentQuestCount = 0;
        quizOverlay.style.display = 'none';
        window.loadRandomVideo();
    };

    window.loadRandomVideo = async function() {
        if (currentQuestCount >= targetQuests) {
            window.renderFinishState();
            return;
        }

        try {
            const { data: videos, error } = await window.supabaseClient
                .from('videos')
                .select('*')
                .eq('status', 'approved');
            
            if (error || !videos || videos.length === 0) {
                window.renderNoVideoState();
                return;
            }

            // [不重複限制已刪除]
            currentVideo = videos[Math.floor(Math.random() * videos.length)];
            
            document.getElementById('video-title').innerText = `挑戰中 (${currentQuestCount + 1}/${targetQuests})`;
            document.getElementById('video-desc').innerText = `觀察片段並準備回答`;

            // 執行加密載入
            await secureLoadVideo(currentVideo.storage_path);

            let lastTime = 0;
            videoElem.ontimeupdate = () => {
                if (videoElem.currentTime - lastTime > 1 || videoElem.currentTime < lastTime) {
                    videoElem.currentTime = lastTime;
                } else { lastTime = videoElem.currentTime; }

                if (videoElem.currentTime >= currentVideo.pause_at) {
                    videoElem.pause();
                    window.showQuiz();
                    videoElem.ontimeupdate = null; 
                }
            };
        } catch (err) {
            console.error(err);
            window.renderNoVideoState();
        }
    };

    window.showQuiz = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2 id="quiz-question">${currentVideo.quiz_data.question || "接下來會發生什麼？"}</h2>
                <div id="options-grid" class="options-grid"></div>
            </div>`;
        const grid = document.getElementById('options-grid');
        [...currentVideo.quiz_data.options].sort(() => Math.random() - 0.5).forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerText = opt;
            btn.onclick = () => window.handleAnswer(opt);
            grid.appendChild(btn);
        });
        quizOverlay.style.display = 'flex';
    };

    // --- [ 4. 回答與證實邏輯 ] ---
    window.handleAnswer = async function(selected) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        
        quizOverlay.innerHTML = `<div class='quiz-card glass'><h2 style='color:white'>驗證中...</h2></div>`;
        
        try {
            const response = await fetch('https://wvnencbfkbjvszsgamdq.functions.supabase.co/reward-points', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ videoId: currentVideo.id, selectedAnswer: selected })
            });
            const result = await response.json();
            
            quizOverlay.innerHTML = `
                <div class='quiz-card glass'>
                    <h2 style='color: ${result.success ? "var(--success)" : "var(--danger)"}'>
                        ${result.success ? "🎉 答對了！" : "❌ 答錯了"}
                    </h2>
                    <p style="color:white; margin-top:10px;">揭曉真相片段...</p>
                </div>`;

            setTimeout(() => {
                quizOverlay.style.display = 'none'; 
                videoElem.play(); 
                
                videoElem.onended = () => {
                    nextStep();
                };
            }, 2000);

        } catch (err) { 
            console.error(err);
            nextStep(); 
        }

        function nextStep() {
            videoElem.onended = null;
            currentQuestCount++;
            if (currentQuestCount >= targetQuests) {
                window.renderFinishState();
            } else {
                window.loadRandomVideo();
            }
        }
    };

    // --- [ 5. UI 輔助功能 ] ---
    window.renderNoVideoState = function() {
        document.getElementById('video-title').innerHTML = `暫無挑戰`;
        if (videoContainer) {
            videoContainer.innerHTML = `<div class="no-video-placeholder"><h3>目前尚無題目</h3></div>`;
        }
    };

    window.renderFinishState = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2>🏁 挑戰完成！</h2>
                <button class="option-btn" onclick="window.renderQuestMenu()">再次挑戰</button>
            </div>`;
        quizOverlay.style.display = 'flex';
    };

    const init = async () => {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            window.renderQuestMenu();
        } else {
            const section = document.querySelector('.video-section');
            if (section) section.style.opacity = "0.4";
        }
    };

    document.addEventListener('DOMContentLoaded', init);
})();
