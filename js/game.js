(function() {
    // --- [ 1. 初始化與變數定義 ] ---
    const SUPABASE_URL = 'https://wvnencbfkbjvszsgamdq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqvnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';
    
    // 【核心綁定變數】
    const DENO_API_BASE = 'https://wvnencbfkbjvszsgamdq.supabase.co/functions/v1'; 

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: true, storageKey: 'brawl-guesser-auth' }
        });
    }

    let currentVideo = null;
    let currentBlobUrl = null; 

    const videoElem = document.getElementById('game-video');
    const quizOverlay = document.getElementById('quiz-overlay');
    const videoContainer = document.querySelector('.video-container');

    // --- [ 2. 安全緩衝載入邏輯 (Blob URL 控制) ] ---
    async function secureLoadVideo(path) {
        try {
            videoElem.ontimeupdate = null;
            videoElem.onended = null;
            videoElem.pause();
            
            const oldBlobUrl = currentBlobUrl; 
            videoElem.src = ""; 
            videoElem.load();

            const { data, error } = await window.supabaseClient.storage.from('videos').download(path);
            if (error) throw error;

            const newBlobUrl = URL.createObjectURL(data);
            currentBlobUrl = newBlobUrl;

            videoElem.controls = false; 
            videoElem.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
            videoElem.disablePictureInPicture = true;

            await new Promise((resolve, reject) => {
                videoElem.oncanplaythrough = () => resolve();
                videoElem.onerror = () => reject(new Error("影片解碼發生錯誤"));
                videoElem.src = currentBlobUrl;
                videoElem.load();
            });

            await videoElem.play();
            if (oldBlobUrl) {
                URL.revokeObjectURL(oldBlobUrl);
            }

        } catch (err) {
            console.error("安全性緩衝載入控制失敗:", err);
            setTimeout(() => window.requestNextQuestion(), 1500);
        }
    }

    document.addEventListener('contextmenu', e => { if (e.target.nodeName === 'VIDEO') e.preventDefault(); }, false);
    window.addEventListener('keydown', e => { if (e.keyCode === 32 && e.target === document.body) e.preventDefault(); });

    // --- [ 3. 核心功能：Google 帳號登入/登出連結 ] ---
    window.signInWithGoogle = async function() {
        try {
            const { error } = await window.supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin + window.location.pathname }
            });
            if (error) throw error;
        } catch (err) { console.error("Google 登入失敗:", err.message); }
    };

    window.signOutUser = async function() {
        try {
            const { error } = await window.supabaseClient.auth.signOut();
            if (error) throw error;
            window.location.reload(); 
        } catch (err) { console.error("登出失敗:", err.message); }
    };

    // --- [ 4. 渲染膠囊與頭像外觀 UI ] ---
    async function checkUserStatus() {
        const authSection = document.querySelector('.auth-status-container');
        if (!authSection) return;

        const { data: { user } } = await window.supabaseClient.auth.getUser();

        if (user) {
            try {
                const { data: profile, error } = await window.supabaseClient
                    .from('profiles')
                    .select('points, avatar_url')
                    .eq('id', user.id)
                    .single();

                if (error) throw error;

                authSection.innerHTML = `
                    <div class="user-container" style="position: relative;">
                        <div class="user-status-pill" id="user-pill-btn">
                            <div class="user-points">
                                <i class="fa-solid fa-coins"></i> ${profile?.points?.toLocaleString() || 0}
                            </div>
                            <img src="${profile?.avatar_url || 'https://via.placeholder.com/30'}" class="user-avatar" alt="Avatar">
                        </div>
                        
                        <div class="user-menu glass" id="user-dropdown-menu">
                            <div class="menu-info" style="margin-bottom:15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                                <div class="menu-name" style="font-weight:bold; color:#fff;">${user.user_metadata.full_name || '使用者'}</div>
                                <div class="menu-email" style="font-size:12px; color:#888;">${user.email}</div>
                            </div>    
                            <a href="shop.html" style="display:block; color:#fff; text-decoration:none; margin:12px 0;"><i class="fa-solid fa-circle-user"></i> 兌換商城</a>
                    <a href="quests.html" style="display:block; color:#fff; text-decoration:none; margin:12px 0;"><i class="fa-solid fa-star"></i> 我的任務</a><button class="btn-logout" onclick="window.signOutUser()">
                                <i class="fa-solid fa-right-from-bracket"></i> 登出帳號
                            </button>
                        </div>
                    </div>
                `;

                const pillBtn = document.getElementById('user-pill-btn');
                const dropdownMenu = document.getElementById('user-dropdown-menu');
                if (pillBtn && dropdownMenu) {
                    pillBtn.addEventListener('click', (e) => {
                        e.stopPropagation(); 
                        dropdownMenu.classList.toggle('active');
                    });
                    document.addEventListener('click', () => dropdownMenu.classList.remove('active'));
                }
                
                const { data: redemptions } = await window.supabaseClient
                    .from('redemptions')
                    .select('rewards(name)')
                    .eq('user_id', user.id)
                    .eq('status', 'completed');

                if (redemptions) {
                    if (redemptions.some(r => r.rewards?.name?.includes('流光金頭像框'))) {
                        const avatar = authSection.querySelector('.user-avatar');
                        if (avatar) {
                            avatar.style.outline = '3px solid #ffb703';
                            avatar.style.boxShadow = '0 0 15px #ffb703, 0 0 5px #fb8500';
                            avatar.style.border = 'none';
                        }
                    }
                    if (redemptions.some(r => r.rewards?.name?.includes('暗黑網頁主題'))) {
                        document.body.classList.add('ultimate-dark-mode');
                    }
                }
            } catch (e) { console.error("外觀渲染錯誤:", e.message); }
        } else {
            authSection.innerHTML = `
                <button class="buy-btn style-login-nav" onclick="window.signInWithGoogle()">
                    <i class="fa-brands fa-google"></i> Google 登入
                </button>`;
        }
    }

    // --- [ 5. 外觀性挑戰選單渲染與 Deno 後端綁定控制 ] ---
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

    // 登出/未登入：鎖定畫面外觀提示
    window.renderLoginRequiredState = function() {
        document.getElementById('video-title').innerText = `請先登入系統`;
        document.getElementById('video-desc').innerText = `本挑戰需要記錄玩家積分，請先登入你的帳號。`;
        
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2 style="margin-bottom: 15px;"><i class="fa-solid fa-lock" style="color: #ffb703;"></i> 挑戰已被鎖定</h2>
                <p style="color: #ccc; margin-bottom: 25px; font-size: 0.95rem;">此遊玩模式需要綁定您的個人帳戶以發放金幣獎勵。</p>
                <button class="option-btn" onclick="window.signInWithGoogle()" style="background: #4285F4; color: white; border: none;">
                    <i class="fa-brands fa-google"></i> 立即登入 Google 帳號
                </button>
            </div>`;
        quizOverlay.style.display = 'flex';
    };

    window.startChallenge = async function(num) {
        quizOverlay.style.display = 'none';
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) { window.renderLoginRequiredState(); return; }
        
        try {
            const response = await fetch(`${DENO_API_BASE}/start-game`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ targetQuests: num })
            });
            const result = await response.json();
            
            if (result.success) {
                window.requestNextQuestion();
            } else {
                window.renderNoVideoState();
            }
        } catch (err) {
            console.error("無法連接到 Deno 後端執行初始化:", err);
            window.renderNoVideoState();
        }
    };

    window.requestNextQuestion = async function() {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) { window.renderLoginRequiredState(); return; }
        
        try {
            const response = await fetch(`${DENO_API_BASE}/next-question`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }
            });
            const data = await response.json();

            if (data.finished) {
                window.renderFinishState();
                return;
            }

            currentVideo = data.video;
            
            document.getElementById('video-title').innerText = `挑戰中 (${data.currentQuestCount + 1}/${data.targetQuests})`;
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
            console.error("後端軌道抓取錯誤:", err);
            window.renderNoVideoState();
        }
    };

    window.showQuiz = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2 id="quiz-question">${currentVideo.question}</h2>
                <div id="options-grid" class="options-grid"></div>
            </div>`;
        const grid = document.getElementById('options-grid');
        
        currentVideo.options.forEach(opt => {
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
        quizOverlay.innerHTML = `<div class='quiz-card glass'><h2 style='color:white'>驗證中...</h2></div>`;
        
        try {
            const response = await fetch(`${DENO_API_BASE}/reward-points`, {
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

            await checkUserStatus();

            setTimeout(() => {
                quizOverlay.style.display = 'none'; 
                videoElem.play(); 
                videoElem.onended = () => {
                    videoElem.onended = null;
                    window.requestNextQuestion();
                };
            }, 2000);

        } catch (err) { 
            console.error(err);
            window.requestNextQuestion(); 
        }
    };

    window.renderNoVideoState = function() {
        document.getElementById('video-title').innerHTML = `暫無挑戰`;
        if (videoContainer) videoContainer.innerHTML = `<div class="no-video-placeholder"><h3>目前尚無題目</h3></div>`;
    };

    window.renderFinishState = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2>🏁 挑戰完成！</h2>
                <button class="option-btn" onclick="window.renderQuestMenu()">再次挑戰</button>
            </div>`;
        quizOverlay.style.display = 'flex';
    };

    // --- [ 6. 側邊 RWD 選單邏輯 ] ---
    function initMobileMenu() {
        const menuToggle = document.getElementById('mobile-menu');
        const navMenu = document.getElementById('nav-menu');
        const menuOverlay = document.getElementById('menu-overlay');
        if (!menuToggle || !navMenu || !menuOverlay) return;

        function toggleMenu() {
            menuToggle.classList.toggle('active');
            navMenu.classList.toggle('active');
            menuOverlay.classList.toggle('active');
            document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : 'auto';
        }
        menuToggle.addEventListener('click', toggleMenu);
        menuOverlay.addEventListener('click', toggleMenu);
    }

    // --- [ 7. 預先抓取跨頁登入紀錄與核心啟動 ] ---
    const init = async () => {
        initMobileMenu();

        // 【關鍵優化】：一進入頁面，主動向 LocalStorage 索取可能存在的快取會話
        const { data: { session: cachedSession } } = await window.supabaseClient.auth.getSession();
        
        if (cachedSession) {
            // 有登入過：直接渲染膠囊 UI 與題數選單
            await checkUserStatus();
            const section = document.querySelector('.video-section');
            if (section) section.style.opacity = "1";
            window.renderQuestMenu();
        } else {
            // 沒登入過：直接擋下並要求登入
            await checkUserStatus();
            window.renderLoginRequiredState();
            const section = document.querySelector('.video-section');
            if (section) section.style.opacity = "0.4";
        }

        // 動態監聽後續的狀態變更（例如在這一頁點擊登入或登出）
        window.supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (session && (event === 'SIGNED_IN')) {
                await checkUserStatus();
                const section = document.querySelector('.video-section');
                if (section) section.style.opacity = "1";
                if (!currentVideo) window.renderQuestMenu();
            } else if (event === 'SIGNED_OUT') {
                await checkUserStatus();
                window.renderLoginRequiredState();
                const section = document.querySelector('.video-section');
                if (section) section.style.opacity = "0.4";
            }
        });
    };

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
