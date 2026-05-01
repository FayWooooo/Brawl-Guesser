/**
 * Brawl Guesser - 終極 Admin 管理系統 (移轉 Storage 強化版)
 */
const SUPABASE_URL = 'https://wvnencbfkbjvszsgamdq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2bmVuY2Jma2JqdnN6c2dhbWRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDQyMzksImV4cCI6MjA5MjY4MDIzOX0.MAjsnfYkS_vJC9WRG8aZMSmjU052d4R9yiYsj9fsVio';

const { createClient: _createClient } = supabase;
const supabaseClient = _createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        storageKey: 'brawl-guesser-auth' 
    }
});

let currentVideoId = null;
let currentVideoPath = null; // 記錄原始上傳路徑

// --- [ 1. 權限驗證 ] ---
async function checkAdmin() {
    console.log("正在驗證管理員權限...");
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        document.getElementById('admin-lock').innerHTML = '<h2>請先登入帳號</h2>';
        return;
    }

    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .maybeSingle();

    if (error || !profile || profile.is_admin !== true) {
        alert("抱歉，您沒有管理員權限。");
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('admin-lock').style.display = 'none';
    document.getElementById('admin-content').style.display = 'block';
    
    loadUsers();
    loadPendingVideos();
}

// --- [ 2. 用戶點數管理 ] ---
async function loadUsers() {
    const { data: users, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, points')
        .order('full_name');

    if (error) return;
    const select = document.getElementById('user-select');
    if (select) {
        select.innerHTML = users.map(u => 
            `<option value="${u.id}">${u.full_name || '未命名'} (點數: ${u.points})</option>`
        ).join('');
    }
}

window.updatePoints = async function(mode) {
    const userId = document.getElementById('user-select').value;
    const amount = parseInt(document.getElementById('point-amount').value) || 0;
    if (!userId) return;

    const { data: user } = await supabaseClient.from('profiles').select('points').eq('id', userId).single();
    let finalPoints = 0;

    if (mode === 'add') finalPoints = (user?.points || 0) + amount;
    else if (mode === 'set') finalPoints = amount;
    else if (mode === 'zero') finalPoints = 0;

    const { error } = await supabaseClient.from('profiles').update({ points: finalPoints }).eq('id', userId);
    if (!error) {
        alert("點數更新成功！");
        loadUsers(); 
    }
};

// --- [ 3. 影片審核流程 ] ---
async function loadPendingVideos() {
    const { data: videos, error } = await supabaseClient
        .from('videos')
        .select('*')
        .eq('status', 'pending');

    const list = document.getElementById('pending-list');
    if (!list) return;

    if (error || !videos || videos.length === 0) {
        list.innerHTML = '<p style="color:#888; text-align:center; padding:20px;">目前無待審核投稿</p>';
        return;
    }

    list.innerHTML = videos.map(v => {
        // 從暫存的 upload Bucket 抓取預覽網址
        const { data: { publicUrl } } = supabaseClient.storage.from('upload').getPublicUrl(v.video_path);
        return `
            <div class="pending-item">
                <div>
                    <span class="category-badge">${v.category}</span> 
                    <span style="margin-left:10px;">${v.title}</span>
                </div>
                <button class="btn-blue" onclick="openEditor('${v.id}', '${publicUrl}', '${v.title}', '${v.video_path}')">審核</button>
            </div>
        `;
    }).join('');
}

window.openEditor = function(id, url, title, path) {
    currentVideoId = id;
    currentVideoPath = path; // 儲存目前的路徑
    const editor = document.getElementById('editor-zone');
    editor.style.display = 'block';
    document.getElementById('editing-title').innerText = title;
    
    const videoPlayer = document.getElementById('review-video');
    videoPlayer.src = url;
    videoPlayer.scrollIntoView({ behavior: 'smooth' });
};

window.setCurrentTime = function() {
    const video = document.getElementById('review-video');
    const pauseInput = document.getElementById('pause-time');
    if (video && pauseInput) {
        pauseInput.value = video.currentTime.toFixed(1);
    }
};

/**
 * 修正版：審核通過邏輯 (使用 copy 避開本地下載)
 */
async function submitReview(status) {
    if (!currentVideoId || !currentVideoPath) return;

    if (status === 'rejected') {
        if (!confirm("確定要退回此投稿嗎？")) return;
        await supabaseClient.from('videos').update({ status: 'rejected' }).eq('id', currentVideoId);
        location.reload();
        return;
    }

    const pauseTime = document.getElementById('pause-time').value;
    const question = document.getElementById('quiz-q').value;
    const options = [
        document.getElementById('opt-1').value.trim(),
        document.getElementById('opt-2').value.trim(),
        document.getElementById('opt-3').value.trim(),
        document.getElementById('opt-4').value.trim()
    ];

    if (!question || options.some(o => o === "")) return alert("請完整填寫題目與選項");

    // 顯示讀取中狀態，避免重複點擊
    const btn = document.querySelector('button[onclick*="approveVideo"]');
    const originalText = btn.innerText;
    btn.innerText = "處理中...";
    btn.disabled = true;

    try {
        const fileName = currentVideoPath.split('/').pop();
        const newPath = `approved/${Date.now()}_${fileName}`;
        
        // --- [ 關鍵修復：跨 Bucket 移檔優化 ] ---
        // 1. 直接從 upload 複製到 videos (不經過瀏覽器下載，避免 ERR_QUIC_PROTOCOL_ERROR)
        const { error: copyErr } = await supabaseClient.storage
            .from('upload')
            .copy(currentVideoPath, newPath, { destinationBucket: 'videos' });

        // 如果你的 SDK 版本不支援 destinationBucket 參數，請用下面的傳統穩健流：
        if (copyErr) {
            console.warn("直接複製失敗，嘗試串流轉移...");
            const { data: blob, error: dlErr } = await supabaseClient.storage
                .from('upload')
                .download(currentVideoPath);
            if (dlErr) throw dlErr;

            const { error: upErr } = await supabaseClient.storage
                .from('videos')
                .upload(newPath, blob, { cacheControl: '3600', upsert: true });
            if (upErr) throw upErr;
        }

        // 2. 獲取永久公開網址
        const { data: { publicUrl } } = supabaseClient.storage.from('videos').getPublicUrl(newPath);

        // 3. 更新資料庫 (包含 url 與 status)
        const { error: dbErr } = await supabaseClient.from('videos').update({
            status: 'approved',
            url: publicUrl,
            storage_path: newPath,
            pause_at: parseFloat(pauseTime),
            quiz_data: {
                question: question,
                options: options,
                correct: options[0]
            }
        }).eq('id', currentVideoId);

        if (dbErr) throw dbErr;

        // 4. 清理 upload 區舊檔案
        await supabaseClient.storage.from('upload').remove([currentVideoPath]);

        alert("✅ 審核完成並發布！");
        location.reload();

    } catch (err) {
        console.error("審核失敗詳細日誌:", err);
        alert("審核失敗，請檢查網路連線或 Storage 權限。\n錯誤訊息: " + err.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

window.approveVideo = () => submitReview('approved');
window.rejectVideo = () => submitReview('rejected');

document.addEventListener('DOMContentLoaded', checkAdmin);