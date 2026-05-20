// --- 1. 初始化 Supabase ---
const _supabaseUrl = 'https://wvnencbfkbjvszsgamdq.supabase.co';
const _supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqdnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

if (!window.supabaseClient) {
    window.supabaseClient = supabase.createClient(_supabaseUrl, _supabaseKey, {
        auth: { persistSession: true, storageKey: 'brawl-guesser-auth' }
    });
}
const supabaseInstance = window.supabaseClient;

// --- 2. 全域變數 ---
let allRewards = [];
let ownedRewardIds = new Set(); // 存放用戶已經購買過的商品 ID
let currentCategory = 'all';
let userProfile = null; 
let selectedItem = null; 

// --- 3. 初始化頁面 ---
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    // 優先執行用戶狀態檢查（抓取點數、頭像與同步跨裝置特效）
    await checkUserStatus(); 
    // 隨後抓取並渲染商城（這時已知哪些商品已購，可直接隱藏）
    await fetchRewards();
});

// --- 4. 抓取商城資料 ---
async function fetchRewards() {
    const shopGrid = document.querySelector('.shop-grid'); 
    if (!shopGrid) return;
    
    try {
        const { data, error } = await supabaseInstance
            .from('rewards')
            .select('*')
            .eq('is_active', true)
            .order('price', { ascending: true });

        if (error) throw error;
        allRewards = data;
        renderShop(allRewards);
    } catch (err) {
        console.error('抓取失敗:', err.message);
        shopGrid.innerHTML = `<p class="error-msg" style="color: var(--danger); text-align: center;">資料載入失敗，請稍後再試。</p>`;
    }
}

// --- 5. 渲染商城卡片 (已購商品將自動隱藏) ---
function renderShop(items) {
    const shopGrid = document.querySelector('.shop-grid');
    if (!shopGrid) return;
    
    shopGrid.innerHTML = '';

    // 過濾分類，同時【核心改動】：如果 ownedRewardIds 裡面有該商品識別，直接過濾掉不顯示！
    const filtered = items.filter(item => {
        const matchCategory = currentCategory === 'all' || item.category === currentCategory;
        const alreadyOwned = ownedRewardIds.has(item.id);
        return matchCategory && !alreadyOwned; // 沒買過才顯示
    });

    if (filtered.length === 0) {
        shopGrid.innerHTML = `<p class="empty-msg" style="color: #888; text-align: center; grid-column: 1/-1; padding: 40px 0;">這個分類目前沒有商品（或你已全部兌換完畢囉！）</p>`;
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'reward-card glass'; 
        
        const stockText = item.stock === -1 ? '無限量供應' : `剩餘庫存: ${item.stock} 件`;
        const isSoldOut = item.stock === 0;

        card.innerHTML = `
            <div class="reward-icon">${getIcon(item.category)}</div>
            <h3 class="reward-name">${item.name}</h3>
            <p class="reward-desc">${item.description}</p>
            <div class="reward-stock" style="font-size: 0.75rem; color: #888; margin-top: -5px; margin-bottom: 10px;">${stockText}</div>
            <div class="price-tag">
                <i class="fa-solid fa-coins"></i> ${item.price}
            </div>
            <button class="buy-btn" data-id="${item.id}" ${isSoldOut ? 'disabled style="background:var(--gray); opacity:0.5;"' : ''}>
                ${isSoldOut ? '已售罄' : '立即兌換'}
            </button>
        `;
        shopGrid.appendChild(card);
    });
}

// --- 6. 事件監聽 (全自動委派，拒絕內聯屬性) ---
function setupEventListeners() {
    // 監聽分類標籤
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCategory = tab.dataset.category;
            renderShop(allRewards);
        });
    });

    // 手機版選單
    const mobileMenu = document.querySelector('.mobile-menu-toggle');
    const navMenu = document.querySelector('.nav-menu-list');
    if (mobileMenu && navMenu) {
        mobileMenu.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            mobileMenu.classList.toggle('is-active');
        });
    }

    // 【購買按鈕點擊委派】包含未登入攔截
    const shopGrid = document.querySelector('.shop-grid');
    if (shopGrid) {
        shopGrid.addEventListener('click', async (e) => {
            if (e.target && e.target.classList.contains('buy-btn')) {
                const { data: { user } } = await supabaseInstance.auth.getUser();
                if (!user) {
                    alert('請先登入後再進行商品兌換！');
                    window.location.href = 'login.html';
                    return;
                }

                const itemId = e.target.getAttribute('data-id');
                const item = allRewards.find(r => r.id === itemId);
                if (item) openPurchaseModal(item);
            }
        });
    }

    // 【內視窗彈窗控制委派】
    const modalOverlay = document.querySelector('.purchase-modal-overlay');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-modal-btn') || e.target === modalOverlay) {
                closePurchaseModal();
            }
            if (e.target.classList.contains('confirm-buy-btn')) {
                if (selectedItem) processPurchase(selectedItem);
            }
        });
    }
}

// --- 7. 內視窗提示彈窗控制 (Modal) ---
function openPurchaseModal(item) {
    selectedItem = item; 
    const modal = document.querySelector('.purchase-modal-overlay');
    if (!modal) return;

    modal.querySelector('.modal-item-name').innerText = item.name;
    modal.querySelector('.modal-item-desc').innerText = item.description;
    modal.querySelector('.modal-item-price').innerHTML = `<i class="fa-solid fa-coins"></i> ${item.price}`;
    modal.querySelector('.modal-item-icon').innerHTML = getIcon(item.category);
    
    const confirmBtn = modal.querySelector('.confirm-buy-btn');
    if (confirmBtn) {
        confirmBtn.innerText = "確認兌換";
        confirmBtn.disabled = false;
    }

    modal.classList.add('show-modal'); 
}

function closePurchaseModal() {
    const modal = document.querySelector('.purchase-modal-overlay');
    if (modal) modal.classList.remove('show-modal');
    selectedItem = null; 
}

// --- 8. 核心：處理安全扣點與跨裝置特效寫入 ---
async function processPurchase(item) {
    const modal = document.querySelector('.purchase-modal-overlay');
    const confirmBtn = modal ? modal.querySelector('.confirm-buy-btn') : null;
    
    const { data: { user } } = await supabaseInstance.auth.getUser();
    if (!user) return;

    if (item.stock === 0) {
        alert('這件商品已經賣完囉！');
        return;
    }
    if (!userProfile || userProfile.points < item.price) {
        alert(`兌換失敗：你的積分不足！`);
        return;
    }

    if (confirmBtn) {
        confirmBtn.innerText = "處理中...";
        confirmBtn.disabled = true;
    }

    try {
        // [步驟 A]：扣除用戶點數
        const newPoints = userProfile.points - item.price;
        const { error: profileError } = await supabaseInstance
            .from('profiles')
            .update({ points: newPoints })
            .eq('id', user.id);

        if (profileError) throw profileError;

        // [步驟 B]：扣除庫存
        if (item.stock > 0) {
            await supabaseInstance
                .from('rewards')
                .update({ stock: item.stock - 1 })
                .eq('id', item.id);
        }

        // [步驟 C]：建立兌換紀錄 (狀態設為完成，代表即時發放)
        const { error: redeemError } = await supabaseInstance
            .from('redemptions')
            .insert({
                user_id: user.id,
                reward_id: item.id,
                price_paid: item.price,
                status: 'completed', // 設定為完成，便於跨裝置判定已擁有該外觀
                admin_notes: `自動核銷發放。商品: ${item.name}`
            });

        if (redeemError) throw redeemError;

        alert(`🎉 兌換成功！已扣除 ${item.price} 積分，特效已與您的帳號永久綁定！`);
        
        closePurchaseModal();
        await checkUserStatus(); // 重載帳號狀態，觸發跨裝置特效渲染與更新點數區
        await fetchRewards();    // 刷新商城，直接將剛買完的商品隱藏

    } catch (err) {
        console.error('兌換流程發生嚴重錯誤:', err.message);
        alert('兌換出錯，請重試！');
        if (confirmBtn) {
            confirmBtn.innerText = "確認兌換";
            confirmBtn.disabled = false;
        }
    }
}

// --- 9. 核心加強：執行外觀性特效 (跨裝置同步渲染) ---
function applyCosmeticEffects(ownedItems) {
    // 預設重設狀態
    document.body.classList.remove('ultimate-dark-mode');
    
    ownedItems.forEach(item => {
        // 1. 流光金頭像框特效
        if (item.rewards?.name && item.rewards.name.includes('流光金頭像框')) {
            const avatar = document.querySelector('.user-avatar');
            if (avatar) {
                avatar.style.outline = '3px solid #ffb703';
                avatar.style.boxShadow = '0 0 15px #ffb703, 0 0 5px #fb8500';
                avatar.style.border = 'none';
            }
        }
        // 2. 暗黑網頁主題特效
        if (item.rewards?.name && item.rewards.name.includes('暗黑網頁主題')) {
            document.body.classList.add('ultimate-dark-mode');
        }
    });
}

// 輔助函數：分類圖標
function getIcon(category) {
    const icons = {
        cosmetic: '<i class="fa-solid fa-shirt" style="color: #ffb703;"></i>',
        title: '<i class="fa-solid fa-id-badge" style="color: #219ebc;"></i>',
        special: '<i class="fa-solid fa-star" style="color: #fb8500;"></i>'
    };
    return icons[category] || '<i class="fa-solid fa-box-open"></i>';
}

// --- 10. 核心功能：抓取用戶點數、同步外觀紀錄、顯示頭像點數區 ---
async function checkUserStatus() {
    const authSection = document.querySelector('.auth-status-container');
    if (!authSection) return;

    const { data: { user } } = await supabaseInstance.auth.getUser();

    if (user) {
        try {
            // [1] 抓取最新的用戶分數與頭像
            const { data: profile, error } = await supabaseInstance
                .from('profiles')
                .select('points, avatar_url')
                .eq('id', user.id)
                .single();

            if (error) throw error;
            userProfile = profile; 

            // [2] 跨頁面、跨裝置核心：從資料庫查詢此用戶買過哪些外觀商品 (關聯查詢)
            const { data: redemptions } = await supabaseInstance
                .from('redemptions')
                .select('reward_id, rewards(name, category)')
                .eq('user_id', user.id)
                .eq('status', 'completed');

            // 記錄到已購 Set 集合中，方便商城隱藏
            ownedRewardIds.clear();
            if (redemptions) {
                redemptions.forEach(r => ownedRewardIds.add(r.reward_id));
            }

            // [3] 精確生成頭像點數區
            authSection.innerHTML = `
                <div class="user-status-pill">
                    <div class="user-points">
                        <i class="fa-solid fa-coins"></i> ${profile?.points?.toLocaleString() || 0}
                    </div>
                    <img src="${profile?.avatar_url || 'https://via.placeholder.com/30'}" class="user-avatar" alt="User Avatar">
                </div>
            `;
            
            // [4] 實時套用這個帳號在所有裝置上已擁有的外觀特效
            if (redemptions) {
                applyCosmeticEffects(redemptions);
            }
            
        } catch (e) {
            console.error("載入帳號狀態與跨裝置特效失敗:", e.message);
        }
    } else {
        // 未登入狀態
        authSection.innerHTML = `<button class="buy-btn style-login-nav" style="padding: 8px 16px; font-size: 0.85rem;">登入</button>`;
        const loginNavBtn = authSection.querySelector('.style-login-nav');
        if (loginNavBtn) {
            loginNavBtn.addEventListener('click', () => {
                window.location.href = 'login.html';
            });
        }
    }
}