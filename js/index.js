/**
 * Brawl Guesser - 完整邏輯控制 (即時點數更新版)
 * 修正內容：加入 Realtime 監聽、優化渲染邏輯、處理登入狀態同步
 */

// 1. 初始化 Supabase
const SUPABASE_URL = 'https://wvnencbfkbjvszsgamdq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqdnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

const { createClient: _createClient } = supabase;
const supabaseClient = _createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'brawl-guesser-auth' 
    }
});

// 全域監聽頻道變數
let profileChannel = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 獲取當前 Session
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
        // 清除網址 URL 的 Hash (讓網址變乾淨)
        if (window.location.hash) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        await renderUserUI(session.user);
        setupRealtimeSubscription(session.user.id); // 啟動點數監聽
    } else {
        renderLoginUI();
    }

    // 監聽權限狀態變動 (登入/登出/Token 過期)
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            await renderUserUI(session.user);
            setupRealtimeSubscription(session.user.id);
        } else if (event === 'SIGNED_OUT') {
            if (profileChannel) supabaseClient.removeChannel(profileChannel);
            renderLoginUI();
        }
    });

    initAnimations();
    initStatsCounter();
});

/**
 * 核心修正：即時監聽資料庫變動
 * 當 Supabase 後台 points 欄位一變，前端會立即反應
 */
function setupRealtimeSubscription(userId) {
    if (profileChannel) supabaseClient.removeChannel(profileChannel);

    profileChannel = supabaseClient
        .channel(`public:profiles:id=eq.${userId}`)
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'profiles', 
            filter: `id=eq.${userId}` 
        }, (payload) => {
            const newPoints = payload.new.points;
            updatePointsDisplay(newPoints);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') ;
        });
}

/**
 * 更新畫面上顯示的點數 (帶有動畫效果)
 */
function updatePointsDisplay(points) {
    const display = document.getElementById('global-points-display');
    if (!display) return;

    // 使用 GSAP 做出數字跳動感
    gsap.to(display, {
        scale: 1.2,
        duration: 0.1,
        onComplete: () => {
            display.innerHTML = `<i class="fa-solid fa-coins"></i> ${points.toLocaleString()}`;
            gsap.to(display, { scale: 1, duration: 0.3 });
        }
    });
}

/**
 * 2. 渲染登入後的 UI
 */
async function renderUserUI(user) {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;
    
    try {
        // 初始讀取一次點數
        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('points')
            .eq('id', user.id)
            .single();

        if (error) throw error;

        const userPoints = profile ? profile.points : 0;
        const avatarUrl = user.user_metadata.avatar_url || 'https://via.placeholder.com/150';

        authSection.innerHTML = `
            <div class="user-container" style="position: relative;">
                <div class="user-status-pill" onclick="toggleUserMenu()" style="cursor:pointer; display: flex; align-items: center; background: rgba(255,255,255,0.1); padding: 5px 15px; border-radius: 50px;">
                    <span class="user-points" id="global-points-display" style="font-weight: bold; color: #FFD700;">
                        <i class="fa-solid fa-coins"></i> ${userPoints.toLocaleString()}
                    </span>
                    <img src="${avatarUrl}" alt="Avatar" class="user-avatar" style="width:32px; height:32px; border-radius:50%; margin-left:10px; border:2px solid #00d2ff;">
                </div>
                <div id="user-menu" class="user-menu glass" style="display:none; position:absolute; right:0; top:50px; min-width:200px; background:rgba(20,20,20,0.95); padding:20px; border-radius:15px; border:1px solid rgba(255,255,255,0.1); z-index:1000; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <div class="menu-info" style="margin-bottom:15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                        <div class="menu-name" style="font-weight:bold; color:#fff;">${user.user_metadata.full_name || '使用者'}</div>
                        <div class="menu-email" style="font-size:12px; color:#888;">${user.email}</div>
                    </div>
                    <a href="shop.html" style="display:block; color:#fff; text-decoration:none; margin:12px 0;"><i class="fa-solid fa-circle-user"></i> 兌換商城</a>
                    <a href="quests.html" style="display:block; color:#fff; text-decoration:none; margin:12px 0;"><i class="fa-solid fa-star"></i> 我的任務</a>
                    <button onclick="logout()" class="btn-logout" style="width:100%; background:#ff4d4d; border:none; color:#fff; padding:10px; border-radius:8px; cursor:pointer; margin-top:10px; font-weight: bold;">
                        <i class="fa-solid fa-right-from-bracket"></i> 登出帳號
                    </button>
                </div>
            </div>
        `;
    } catch (err) {
        console.error("渲染 UI 發生錯誤 (可能是 RLS 或 Profile 未建立):", err);
    }
}

/**
 * 3. 渲染登入按鈕
 */
function renderLoginUI() {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;
    authSection.innerHTML = `
        <button class="btn-login" onclick="login()" style="padding: 10px 20px; border-radius: 50px; border: none; background: #fff; color: #000; font-weight: bold; cursor: pointer;">
            <i class="fa-brands fa-google"></i> Google 登入
        </button>
    `;
}

/**
 * 4. 功能性函式
 */
async function login() {
    await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            queryParams: { prompt: 'select_account' },
            redirectTo: window.location.origin + window.location.pathname
        }
    });
}

async function logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (!error) window.location.reload();
}

window.toggleUserMenu = function() {
    const menu = document.getElementById('user-menu');
    if (menu) {
        const isVisible = menu.style.display === 'block';
        menu.style.display = isVisible ? 'none' : 'block';
    }
};

/**
 * 5. 動畫效果
 */
function initAnimations() {
    if (typeof gsap === 'undefined' || !gsap.registerPlugin) return;
    // 簡單的揭露動畫
    gsap.utils.toArray(".reveal").forEach(el => {
        gsap.to(el, {
            scrollTrigger: {
                trigger: el,
                start: "top 85%",
            },
            opacity: 1,
            y: 0,
            duration: 1,
            ease: "power4.out"
        });
    });
}

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