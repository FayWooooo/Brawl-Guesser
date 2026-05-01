/**
 * Brawl Guesser - 投稿頁核心邏輯 (Realtime 實時同步強化版)
 */
(function() {
    // 1. 初始化 Supabase
    const SUPABASE_URL = 'https://wvnencbfkbjvszsgamdq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqdnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: true,
                storageKey: 'brawl-guesser-auth'
            }
        });
    }

    const DENO_API_ENDPOINT = 'https://wvnencbfkbjvszsgamdq.functions.supabase.co/submit-video';
    let selectedFile = null;

    // --- [ 核心：實時監聽點數變動 ] ---
    window.initRealtimeListener = function(userId) {

        // 清除舊頻道並建立新頻道
        window.supabaseClient.removeAllChannels();
        
        const channel = window.supabaseClient
            .channel('db_changes')
            .on(
                'postgres_changes', 
                { 
                    event: 'UPDATE', 
                    schema: 'public', 
                    table: 'profiles', 
                    filter: `id=eq.${userId}` 
                }, 
                (payload) => {
                    const newPoints = payload.new.points;
                    const pointsDisplay = document.getElementById('global-points-display');
                    
                    if (pointsDisplay) {
                        // 1. 更新數字
                        pointsDisplay.innerHTML = `<i class="fa-solid fa-coins"></i> ${newPoints.toLocaleString()}`;
                        
                        // 2. 觸發視覺特效 (縮放並變色)
                        pointsDisplay.style.color = "#00FF7F"; 
                        pointsDisplay.style.transform = "scale(1.3) translateY(-2px)";
                        pointsDisplay.style.textShadow = "0 0 10px rgba(0,255,127,0.5)";
                        
                        setTimeout(() => {
                            pointsDisplay.style.color = "#FFD700";
                            pointsDisplay.style.transform = "scale(1) translateY(0)";
                            pointsDisplay.style.textShadow = "none";
                        }, 600);
                    }
                }
            );

        channel.subscribe((status) => {
        });
    };

    // --- [ UI 渲染邏輯 ] ---
    window.renderUserUI = async function(user) {
        const authSection = document.getElementById('auth-section');
        if (!authSection || !user) return;

        try {
            const { data: profile } = await window.supabaseClient
                .from('profiles')
                .select('points')
                .eq('id', user.id)
                .single();

            const points = profile ? profile.points : 0;
            const avatar = user.user_metadata.avatar_url || '';
            const userName = user.user_metadata.full_name || '玩家';

            authSection.innerHTML = `
                <div class="user-container" style="position: relative;">
                    <div class="user-status-pill" onclick="toggleUserMenu(event)" style="cursor:pointer; display: flex; align-items: center; background: rgba(255,255,255,0.08); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
                        <span class="user-points" id="global-points-display" style="color: #FFD700; font-weight: bold; transition: all 0.3s; display: inline-block;">
                            <i class="fa-solid fa-coins"></i> ${points.toLocaleString()}
                        </span>
                        <img src="${avatar}" alt="Avatar" class="user-avatar" style="width:30px; height:30px; border-radius:50%; margin-left:10px; border:2px solid #00d2ff;">
                    </div>
                    
                    <div id="user-menu" class="user-menu glass" style="display:none; position:absolute; right:0; top:55px; background:rgba(20,20,20,0.95); padding:20px; border-radius:15px; border:1px solid rgba(255,255,255,0.1); z-index:1000; width: 220px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                        <div class="menu-info" style="margin-bottom:15px;">
                            <div class="menu-name" style="font-weight:bold; color:#fff;">${userName}</div>
                            <div class="menu-email" style="font-size:12px; color:#888; overflow: hidden; text-overflow: ellipsis;">${user.email}</div>
                        </div>
                        <a href="profile.html" class="dropdown-item" style="display:block; color:#fff; text-decoration:none; margin:10px 0; font-size: 0.9rem;">
                            <i class="fa-solid fa-circle-user"></i> 個人主頁
                        </a>
                        <a href="quests.html" class="dropdown-item" style="display:block; color:#fff; text-decoration:none; margin:10px 0; font-size: 0.9rem;">
                            <i class="fa-solid fa-star"></i> 我的任務
                        </a>
                        <hr style="border:0; border-top:1px solid rgba(255,255,255,0.1); margin:10px 0;">
                        <button onclick="handleLogout()" class="btn-logout" style="width:100%; background:#ff4d4d; border:none; color:#fff; padding:10px; border-radius:8px; cursor:pointer; margin-top:10px; font-weight: bold;">
                            <i class="fa-solid fa-right-from-bracket"></i> 登出帳號
                        </button>
                    </div>
                </div>`;
            
            window.toggleUploadLock(false); 
        } catch (err) {
            console.error("渲染失敗:", err);
        }
    };

    window.toggleUserMenu = function(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('user-menu');
        if (!menu) return;
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    };

    document.addEventListener('click', () => {
        const menu = document.getElementById('user-menu');
        if (menu) menu.style.display = 'none';
    });

    // --- [ 登入/登出核心 ] ---
    async function initAuth() {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        
        if (session) {
            await renderUserUI(session.user);
            window.initRealtimeListener(session.user.id);
        } else {
            window.toggleUploadLock(true);
        }

        window.supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (session) {
                await renderUserUI(session.user);
                window.initRealtimeListener(session.user.id);
            } else {
                window.toggleUploadLock(true);
                window.supabaseClient.removeAllChannels();
                document.getElementById('auth-section').innerHTML = 
                    `<button class="btn-login" onclick="login()"><i class="fa-brands fa-google"></i> Google 登入</button>`;
            }
        });
    }

    window.login = async () => {
        await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.href }
        });
    };

    window.handleLogout = async () => {
        await window.supabaseClient.auth.signOut();
        localStorage.removeItem('brawl-guesser-auth');
        window.location.reload();
    };

    window.toggleUploadLock = (isLocked) => {
        const card = document.getElementById('upload-container-card');
        const submitBtn = document.getElementById('submit-btn');
        if (!card || !submitBtn) return;
        card.style.opacity = isLocked ? "0.4" : "1";
        card.style.pointerEvents = isLocked ? "none" : "auto";
        document.getElementById('btn-text').innerText = isLocked ? "請先登入" : "確認投稿";
    };

    // --- [ 投稿邏輯 ] ---
    window.handleUpload = async function() {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return window.login();

        const title = document.getElementById('video-title').value.trim();
        const category = document.getElementById('video-category').value;

        if (!selectedFile || !title) return alert('請填寫標題並選取影片');

        const submitBtn = document.getElementById('submit-btn');
        const modal = document.getElementById('upload-modal');
        const modalStatus = document.getElementById('modal-status');
        const modalProgress = document.getElementById('modal-progress-fill');
        const modalPercent = document.getElementById('modal-percent');

        submitBtn.disabled = true;
        modal.style.display = 'flex';
        modalStatus.innerText = '正在上傳...';

        try {
            const fileExt = selectedFile.name.split('.').pop();
            const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;

            const { data: storageData, error: storageError } = await window.supabaseClient.storage
                .from('upload')
                .upload(filePath, selectedFile, {
                    onUploadProgress: (p) => {
                        const percent = Math.round((p.loaded / p.total) * 100);
                        modalProgress.style.width = percent + '%';
                        modalStatus.innerText = '上船中...';
                    }
                });

            if (storageError) throw storageError;

            modalStatus.innerText = '伺服器處理中...';

            const response = await fetch(DENO_API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    videoPath: storageData.path,
                    title: title,
                    category: category
                })
            });

            if (!response.ok) throw new Error('伺服器加點失敗');

            modalStatus.innerHTML = '<span style="color:#2ecc71">投稿成功！</span>';
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);

        } catch (err) {
            alert('投稿出錯: ' + err.message);
            submitBtn.disabled = false;
            modal.style.display = 'none';
        }
    };

    function initFileControls() {
        const fileInput = document.getElementById('file-input');
        const dropZone = document.getElementById('drop-zone');
        const fileInfo = document.getElementById('file-info');
        if (!fileInput || !dropZone) return;

        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            if (e.target.files[0]) {
                const file = e.target.files[0];
                if (file.type !== 'video/mp4') return alert('僅支援 MP4 格式');
                selectedFile = file;
                fileInfo.style.display = 'block';
                fileInfo.innerHTML = `<i class="fa-solid fa-check"></i> 已就緒: ${file.name}`;
            }
        };
    }

    document.addEventListener('DOMContentLoaded', () => {
        initAuth();
        initFileControls();
    });

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