(function() {
    // --- [ 1. 初始化與變數定義 ] ---
    const SUPABASE_URL = 'https://wvnencbfkbjvszsgamdq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqvnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: true, storageKey: 'brawl-guesser-auth' }
        });
    }

    let playlistQuests = [];   // 【核心改動】本次挑戰洗牌後的隨機影片題庫
    let currentVideo = null;
    let targetQuests = 5; 
    let currentQuestCount = 0;
    let currentBlobUrl = null; // 用於安全控管臨時網址

    const videoElem = document.getElementById('game-video');
    const quizOverlay = document.getElementById('quiz-overlay');
    const videoContainer = document.querySelector('.video-container');

    // --- [ 2. 徹底解決卡死：安全緩衝載入邏輯 (Blob URL) ] ---
    async function secureLoadVideo(path) {
        try {
            // A. 先徹底卸載舊事件，中斷當前播放，清空 src 迫使瀏覽器釋放硬體解碼器
            videoElem.ontimeupdate = null;
            videoElem.onended = null;
            videoElem.pause();
            
            const oldBlobUrl = currentBlobUrl; // 暫存舊網址，不當下釋放防止死鎖
            videoElem.src = ""; 
            videoElem.load();

            // B. 從雲端下載新影片數據
            const { data, error } = await window.supabaseClient.storage.from('videos').download(path);
            if (error) throw error;

            // C. 建立新臨時網址
            const newBlobUrl = URL.createObjectURL(data);
            currentBlobUrl = newBlobUrl;

            // D. 配置安全屬性
            videoElem.controls = false; 
            videoElem.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
            videoElem.disablePictureInPicture = true;

            // E. 利用 Promise 確保瀏覽器完全吞下新影片來源
            await new Promise((resolve, reject) => {
                videoElem.oncanplaythrough = () => resolve();
                videoElem.onerror = () => reject(new Error("影片解碼發生錯誤"));
                videoElem.src = currentBlobUrl;
                videoElem.load();
            });

            // F. 確定新影片成功播放了，這時再安全釋放舊的 Blob 記憶體，不干涉解碼軌道
            await videoElem.play();
            if (oldBlobUrl) {
                URL.revokeObjectURL(oldBlobUrl);
            }

        } catch (err) {
            console.error("安全載入或影片切換死鎖修復失敗:", err);
            // 遇到瀏覽器硬體極限卡死時的安全防線：強行跳下一題
            setTimeout(() => nextStep(), 1500);
        }
    }

    // --- [ 全域防護：禁止右鍵與快捷鍵 ] ---
    document.addEventListener('contextmenu', e => {
        if (e.target.nodeName === 'VIDEO') e.preventDefault();
    }, false);

    window.addEventListener('keydown', e => {
        if (e.keyCode === 32 && e.target === document.body) {
            e.preventDefault();
        }
    });

    // --- [ 3. 核心功能：即時刷新頭像與點數區 + 跨裝置外觀同步 ] ---
    async function checkUserStatus() {
        const authSection = document.querySelector('.auth-status-container');
        if (!authSection) return;

        const { data: { user } } = await window.supabaseClient.auth.getUser();

        if (user) {
            try {
                // 1. 撈取最新積分
                const { data: profile, error } = await window.supabaseClient
                    .from('profiles')
                    .select('points, avatar_url')
                    .eq('id', user.id)
                    .single();

                if (error) throw error;

                // 2. 刷新渲染點數頭像區
                authSection.innerHTML = `
                    <div class="user-status-pill">
                        <div class="user-points">
                            <i class="fa-solid fa-coins"></i> ${profile?.points?.toLocaleString() || 0}
                        </div>
                        <img src="${profile?.avatar_url || 'https://via.placeholder.com/30'}" class="user-avatar" alt="Avatar">
                    </div>
                `;
                
                // 3. 同步穿戴特效
                const { data: redemptions } = await window.supabaseClient
                    .from('redemptions')
                    .select('rewards(name)')
                    .eq('user_id', user.id)
                    .eq('status', 'completed');

                if (redemptions) {
                    const hasGoldFrame = redemptions.some(r => r.rewards?.name && r.rewards.name.includes('流光金頭像框'));
                    if (hasGoldFrame) {
                        const avatar = authSection.querySelector('.user-avatar');
                        if (avatar) {
                            avatar.style.outline = '3px solid #ffb703';
                            avatar.style.boxShadow = '0 0 15px #ffb703, 0 0 5px #fb8500';
                            avatar.style.border = 'none';
                        }
                    }
                    
                    const hasDarkTheme = redemptions.some(r => r.rewards?.name && r.rewards.name.includes('暗黑網頁主題'));
                    if (hasDarkTheme) {
                        document.body.classList.add('ultimate-dark-mode');
                    }
                }
                
            } catch (e) {
                console.error("同步頂部數據失敗:", e.message);
            }
        } else {
            authSection.innerHTML = `<button class="buy-btn style-login-nav" style="padding: 8px 16px; font-size: 0.85rem;">登入</button>`;
            const loginNavBtn = authSection.querySelector('.style-login-nav');
            if (loginNavBtn) {
                loginNavBtn.addEventListener('click', () => {
                    window.location.href = 'login.html';
                });
            }
        }
    }

    // --- [ 4. 遊戲流程控制：洗牌演算法隨機題庫 ] ---
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

    // 核心優化：點擊題數時，一次性生成本次不重複隨機歌單/影片單
    window.startChallenge = async function(num) {
        targetQuests = num;
        currentQuestCount = 0;
        quizOverlay.style.display = 'none';
        
        try {
            // 撈取全體審核通過的庫存影片
            const { data: videos, error } = await window.supabaseClient
                .from('videos')
                .select('*')
                .eq('status', 'approved');

            if (error || !videos || videos.length === 0) {
                window.renderNoVideoState();
                return;
            }

            // Fisher-Yates 洗牌演算法（將庫存順序打到極致隨機）
            for (let i = videos.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [videos[i], videos[j]] = [videos[j], videos[i]];
            }

            // 根據玩家選擇的題數切出專屬題庫，完美解決「重複播同一個」的問題
            playlistQuests = videos.slice(0, targetQuests);

            // 開始播放第一關
            window.loadRandomVideo();

        } catch (err) {
            console.error("題庫隨機建立失敗:", err);
            window.renderNoVideoState();
        }
    };

    window.loadRandomVideo = async function() {
        // 安全檢查
        if (currentQuestCount >= targetQuests || currentQuestCount >= playlistQuests.length) {
            window.renderFinishState();
            return;
        }

        try {
            // 依序從打洗好的隨機題庫中取出當前關卡影片
            currentVideo = playlistQuests[currentQuestCount];
            
            document.getElementById('video-title').innerText = `挑戰中 (${currentQuestCount + 1}/${targetQuests})`;
            document.getElementById('video-desc').innerText = `觀察片段並準備回答`;

            // 安全緩衝載入，排除死鎖卡退
            await secureLoadVideo(currentVideo.storage_path);

            let lastTime = 0;
            videoElem.ontimeupdate = () => {
                if (videoElem.currentTime - lastTime > 1 || videoElem.currentTime < lastTime) {
                    videoElem.currentTime = lastTime;
                } else { 
                    lastTime = videoElem.currentTime; 
                }

                if (videoElem.currentTime >= currentVideo.pause_at) {
                    videoElem.pause();
                    window.showQuiz();
                    videoElem.ontimeupdate = null; // 精確卸載，不污染下關
                }
            };
        } catch (err) {
            console.error(err);
            nextStep();
        }
    };

    window.showQuiz = function() {
        quizOverlay.innerHTML = `
            <div class="quiz-card glass">
                <h2 id="quiz-question">${currentVideo.quiz_data.question || "接下來會發生什麼？"}</h2>
                <div id="options-grid" class="options-grid"></div>
            </div>`;
        const grid = document.getElementById('options-grid');
        
        // 選項打亂
        [...currentVideo.quiz_data.options].sort(() => Math.random() - 0.5).forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerText = opt;
            btn.onclick = () => window.handleAnswer(opt);
            grid.appendChild(btn);
        });
        quizOverlay.style.display = 'flex';
    };

    // --- [ 5. 回答與即時同步點數 ] ---
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

            // 【即時刷新防線】答完題立刻去 profiles 抓最新的點數更新頂部，不用重整網頁
            await checkUserStatus();

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
    };

    function nextStep() {
        videoElem.onended = null;
        videoElem.ontimeupdate = null; 
        currentQuestCount++;
        if (currentQuestCount >= targetQuests) {
            window.renderFinishState();
        } else {
            window.loadRandomVideo();
        }
    }

    // --- [ 6. UI 輔助功能 ] ---
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
        // 初始化立刻加載點數頭像與跨裝置外觀
        await checkUserStatus();

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