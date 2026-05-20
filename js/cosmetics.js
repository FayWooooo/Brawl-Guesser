// 全站通用：跨網頁、跨裝置外觀實時同步偵測器
(function() {
    const _supabaseUrl = 'https://wvnencbfkbjvszsgamdq.supabase.co';
    const _supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqdnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(_supabaseUrl, _supabaseKey, {
            auth: { persistSession: true, storageKey: 'brawl-guesser-auth' }
        });
    }

    // 監聽登入狀態改變，或是頁面加載完成時自動撈取外觀
    document.addEventListener('DOMContentLoaded', initCosmetics);
    
    async function initCosmetics() {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) return;

        try {
            // 從購買紀錄中，撈出該用戶買過、且狀態為 completed 的所有外觀商品
            const { data: redemptions, error } = await window.supabaseClient
                .from('redemptions')
                .select('rewards(name, category)')
                .eq('user_id', user.id)
                .eq('status', 'completed');

            if (error) throw error;
            if (!redemptions) return;

            // 清除舊特效類名，避免疊加衝突
            document.body.classList.remove('ultimate-dark-mode');

            redemptions.forEach(item => {
                const rewardName = item.rewards?.name || '';

                // 1. 跨頁面套用：暗黑網頁主題
                if (rewardName.includes('暗黑網頁主題')) {
                    document.body.classList.add('ultimate-dark-mode');
                }

                // 2. 跨頁面套用：流光金頭像框
                if (rewardName.includes('流光金頭像框')) {
                    // 因為頭像點數區可能是非同步渲染，用定時器確保抓得到圖片
                    let checkAvatarExist = setInterval(() => {
                        const avatar = document.querySelector('.user-avatar');
                        if (avatar) {
                            avatar.style.outline = '3px solid #ffb703';
                            avatar.style.boxShadow = '0 0 15px #ffb703, 0 0 5px #fb8500';
                            avatar.style.border = 'none';
                            clearInterval(checkAvatarExist); // 抓到了就停止迴圈
                        }
                    }, 200);
                    // 5秒後安全強退防止無限迴圈
                    setTimeout(() => clearInterval(checkAvatarExist), 5000);
                }
            });

        } catch (e) {
            console.error('全站外觀載入失敗:', e.message);
        }
    }

    // 暴露全域重新整理外觀的方法，給 shop.js 購買成功時即時呼叫
    window.refreshGlobalCosmetics = initCosmetics;
})();