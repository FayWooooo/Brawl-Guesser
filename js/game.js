(function() {
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

    // --- [ 修改：從 localStorage 讀取已做過的題目 ID ] ---
    const STORAGE_KEY = 'brawl_guesser_played_ids';
    let playedVideoIds = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

    const videoElem = document.getElementById('game-video');
    const quizOverlay = document.getElementById('quiz-overlay');
    const videoContainer = document.querySelector('.video-container');

    // 保存記錄到本地的輔助函數
    const savePlayedIds = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(playedVideoIds));
    };

    // --- [ 1. UI 渲染與權限控制 ] ---
    const updateAuthUI = async (user) => {
        const authSection = document.getElementById('auth-section');
        if (!authSection) return;

        if (!user) {
            authSection.innerHTML = `<button class="btn-login" onclick="window.login()"><i class="fa-brands fa-google"></i></button>`;
            return;
        }

        const { data: profile } = await window.supabaseClient.from('profiles').select('points').eq('id', user.id).single();
        const points = profile ? profile.points : 0;
        
        authSection.innerHTML = `
            <div class="user-status-pill">
                <span class="user-points" id="global-points-display">
                    <i class="fa-solid fa-coins"></i> ${points.toLocaleString()}
                </span>
                <img src="${user.user_metadata.avatar_url}" class="user-avatar" onerror="this.src='https://via.placeholder.com/30'">
            </div>
        `;
    };

    window.toggleGameLock = (isLocked) => {
        const section = document.querySelector('.video-section');
        if (section) {
            section.style.opacity = isLocked ? "0.4" : "1";
            section.style.pointerEvents = isLocked ? "none" : "auto";
        }
    };

    window.login = () => {
        window.supabaseClient.auth.signInWithOAuth({ 
            provider: 'google', 
            options: { redirectTo: window.location.origin + window.location.pathname } 
        });
    };

    // --- [ 2. 影片加密載入 ] ---
    async function secureLoadVideo(path) {
        try {
            const { data, error } = await window.supabaseClient.storage.from('videos').download(path);
            if (error) throw error;
            
            const blobUrl = URL.createObjectURL(data);
            videoElem.src = blobUrl;
            
            videoElem.onloadeddata = () => {
                URL.revokeObjectURL(blobUrl); 
                videoElem.muted = true; 
                videoElem.play().catch(() => console.log("等待點擊播放"));
            };
        } catch (err) {
            console.error("載入失敗", err);
        }
    }

    // --- [ 3. 遊戲流程 ] ---
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

    window.renderNoVideoState = function(isOutOfVideos = false) {
        const title = isOutOfVideos ? "題目已用盡" : "暫無挑戰";
        const desc = isOutOfVideos ? "你已經玩過目前所有的題目了！" : "目前尚無題目，請稍後再試。";
        
        document.getElementById('video-title').innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${title}`;
        if (videoContainer) {
            videoContainer.innerHTML = `
                <div class="no-video-placeholder" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;width:100%;background:#000;color:#888;text-align:center;padding:20px;">
                    <i class="fa-solid fa-face-grin-stars" style="font-size:4rem;margin-bottom:20px;opacity:0.2;"></i>
                    <h3 style="color:#fff;margin-bottom:10px;">${title}</h3>
                    <p style="margin-bottom:20px;">${desc}</p>
                </div>`;
        }
    };

    window.loadRandomVideo = async function() {
        if (currentQuestCount >= targetQuests) {
            window.renderFinishState();
            return;
        }

        try {
            const { data: videos, error } = await window.supabaseClient.from('videos').select('*').eq('status', 'approved');
            
            if (error || !videos || videos.length === 0) {
                window.renderNoVideoState();
                return;
            }

            // 過濾掉 localStorage 中記錄過的 ID
            const availableVideos = videos.filter(v => !playedVideoIds.includes(v.id));

            if (availableVideos.length === 0) {
                window.renderNoVideoState(true);
                return;
            }

            currentVideo = availableVideos[Math.floor(Math.random() * availableVideos.length)];
            
            // 存入陣列並寫入 localStorage
            playedVideoIds.push(currentVideo.id);
            savePlayedIds();

            document.getElementById('video-title').innerText = `挑戰中 (${currentQuestCount + 1}/${targetQuests})`;
            document.getElementById('video-desc').innerText = `觀察片段並準備回答`;

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

    // ... 其餘 showQuiz, handleAnswer, renderFinishState, init 等邏輯保持不變 ...
    // (請直接使用你現有的代碼補完)

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

    window.handleAnswer = async function(selected) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        quizOverlay.innerHTML = "<div class='quiz-card glass'><h2 style='color:white'>驗證中...</h2></div>";
        
        try {
            const response = await fetch('https://wvnencbfkbjvszsgamdq.functions.supabase.co/reward-points', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ videoId: currentVideo.id, selectedAnswer: selected })
            });
            const result = await response.json();
            
            quizOverlay.innerHTML = `
                <div class='quiz-card glass'>
                    <h2 style='color: ${result.success ? "#34c759" : "#ff3b30"}'>
                        ${result.success ? "🎉 答對了！" : "❌ 答錯了"}
                    </h2>
                    <p style="color:white; margin-top:10px;">3 秒後自動開始下一題...</p>
                </div>`;
            
            videoElem.play();
            
            setTimeout(() => {
                currentQuestCount++;
                quizOverlay.style.display = 'none';
                window.loadRandomVideo();
            }, 3000);

        } catch (err) { 
            currentQuestCount++;
            window.loadRandomVideo(); 
        }
    };

    window.renderFinishState = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2>🏁 挑戰完成！</h2>
                <p style="color:white; margin: 15px 0;">你已完成 ${targetQuests} 題挑戰</p>
                <button class="option-btn" onclick="window.renderQuestMenu()">再次挑戰</button>
                <button class="option-btn" onclick="location.href='index.html'" style="background:none; border:1px solid var(--gray);">返回首頁</button>
            </div>`;
        quizOverlay.style.display = 'flex';
    };

    const startApp = async (session) => {
        if (isInitialized) return;
        isInitialized = true;
        if (session) {
            currentUser = session.user;
            await updateAuthUI(currentUser);
            window.toggleGameLock(false);
            window.renderQuestMenu();
        } else {
            await updateAuthUI(null);
            window.toggleGameLock(true);
        }
    };

    const init = async () => {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        await startApp(session);
        window.supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                if (!isInitialized) await startApp(session);
            } else if (event === 'SIGNED_OUT') {
                location.reload();
            }
        });
    };

    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('contextmenu', e => e.preventDefault());
})();
document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('mobile-menu');
    const navMenu = document.getElementById('nav-menu');
    const menuOverlay = document.getElementById('menu-overlay');

    function toggleMenu() {
        menuToggle.classList.toggle('active');
        navMenu.classList.toggle('active');
        menuOverlay.classList.toggle('active');
        
        // 選單開啟時防止背景頁面捲動
        document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : 'auto';
    }

    // 監聽點擊事件
    menuToggle.addEventListener('click', toggleMenu);
    menuOverlay.addEventListener('click', toggleMenu);

    // 點擊選單內的連結後自動關閉選單
    const navLinks = document.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu.classList.contains('active')) toggleMenu();
        });
    });
});