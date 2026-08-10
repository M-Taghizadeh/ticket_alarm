// Safar724 Ticket Monitoring App JS

let currentMonitorId = null;
let currentFilter = 'all';
let soundEnabled = true;
let citiesData = [];
let deferredInstallPrompt = null;

// Web Audio API Synthesizer for instant crisp alarm chime
const playAlarmSound = () => {
    if (!soundEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        
        const now = ctx.currentTime;
        // Chime sequence: D5 -> A5 -> D6
        const tones = [587.33, 880, 1174.66];
        tones.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.12);
            
            gain.gain.setValueAtTime(0, now + idx * 0.12);
            gain.gain.linearRampToValueAtTime(0.3, now + idx * 0.12 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start(now + idx * 0.12);
            osc.stop(now + idx * 0.12 + 0.35);
        });
    } catch (e) {
        console.log("Audio play suppressed:", e);
    }
};

// Notification Toast
const showToast = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

// DOM Content Loaded
document.addEventListener('DOMContentLoaded', () => {
    initPWA();
    initCities();
    initTelegramModal();
    initSoundToggle();
    
    // Initial Load
    fetchMonitors();
    fetchHistory();
    fetchSettings();
    
    // Form Listeners
    document.getElementById('form-add-url').addEventListener('submit', handleAddUrl);
    document.getElementById('btn-refresh-all').addEventListener('click', handleRefreshAll);
    document.getElementById('btn-clear-history').addEventListener('click', handleClearHistory);
    
let cachedBuses = [];
let cachedPurchaseUrl = '';

// Filter Pills Listener
document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        renderBuses();
    });
});
    
    // Auto Refresh every 10 seconds for UI updates
    setInterval(() => {
        fetchMonitors(true);
        fetchHistory(true);
        if (currentMonitorId) fetchServices(currentMonitorId, true);
    }, 10000);
});

// Service Worker & PWA Install
const initPWA = () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration failed:', err));
    }
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
    });

    const btnInstall = document.getElementById('btn-pwa-install');
    if (btnInstall) {
        btnInstall.addEventListener('click', async () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const choice = await deferredInstallPrompt.userChoice;
                if (choice.outcome === 'accepted') {
                    showToast('اپلیکیشن با موفقیت روی دستگاه شما نصب شد!', 'success');
                }
                deferredInstallPrompt = null;
            } else {
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                if (isIOS) {
                    showToast('در آیفون: دکمه Share مرورگر Safari را بزنید و گزینه Add to Home Screen را انتخاب کنید.', 'info');
                } else {
                    showToast('برای نصب: از منوی ۳ نقطه مرورگر گزینه Install یا Add to Home Screen را بزنید (یا آیکون ➕ نوار آدرس).', 'info');
                }
            }
        });
    }
};

// Tab Switching
const initTabSwitching = () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });
};

// Load Cities for Autocomplete
const initCities = async () => {
    try {
        const resp = await fetch('/api/cities');
        citiesData = await resp.json();
        const datalist = document.getElementById('cities-list');
        if (datalist && Array.isArray(citiesData)) {
            datalist.innerHTML = citiesData.map(c => `<option value="${c.PersianName}">${c.Name} - ${c.ProvincePersianName}</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to load cities:', e);
    }
};

// Sound Toggle
const initSoundToggle = () => {
    const btn = document.getElementById('btn-sound-toggle');
    const icon = document.getElementById('sound-icon');
    
    btn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        if (soundEnabled) {
            icon.className = 'fa-solid fa-volume-high';
            btn.style.color = '#10b981';
            playAlarmSound();
            showToast('صدای هشدار فعال شد.', 'success');
        } else {
            icon.className = 'fa-solid fa-volume-xmark';
            btn.style.color = '#ef4444';
            showToast('صدای هشدار غیرفعال شد.', 'info');
        }
    });
};

// Telegram Modal & Settings
const initTelegramModal = () => {
    const modal = document.getElementById('modal-telegram');
    const btnOpen = document.getElementById('btn-telegram-modal');
    const btnClose = document.getElementById('btn-close-telegram');
    const form = document.getElementById('form-telegram');
    const btnTest = document.getElementById('btn-test-telegram');
    
    btnOpen.addEventListener('click', () => {
        fetchSettings();
        modal.classList.add('active');
    });
    
    btnClose.addEventListener('click', () => modal.classList.remove('active'));
    modal.querySelector('.modal-backdrop').addEventListener('click', () => modal.classList.remove('active'));
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('tg-token').value.trim();
        const chat_id = document.getElementById('tg-chat-id').value.trim();
        const enabled = document.getElementById('tg-enabled').checked;
        
        try {
            const resp = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_token: token,
                    telegram_chat_id: chat_id,
                    telegram_enabled: enabled
                })
            });
            if (resp.ok) {
                showToast('تنظیمات تلگرام ذخیره شد.', 'success');
                modal.classList.remove('active');
            }
        } catch (err) {
            showToast('خطا در ذخیره تنظیمات', 'error');
        }
    });
    
    btnTest.addEventListener('click', async () => {
        // Save first then test
        const token = document.getElementById('tg-token').value.trim();
        const chat_id = document.getElementById('tg-chat-id').value.trim();
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_token: token, telegram_chat_id: chat_id, telegram_enabled: true })
        });
        
        try {
            const resp = await fetch('/api/test-telegram', { method: 'POST' });
            const data = await resp.json();
            if (resp.ok) {
                showToast('پیام تست به تلگرام ارسال شد! 📱', 'success');
            } else {
                showToast(data.detail || 'خطا در ارسال پیام تست', 'error');
            }
        } catch (err) {
            showToast('ارتباط با تلگرام برقرار نشد.', 'error');
        }
    });
};

const fetchSettings = async () => {
    try {
        const resp = await fetch('/api/settings');
        const data = await resp.json();
        document.getElementById('tg-token').value = data.telegram_token || '';
        document.getElementById('tg-chat-id').value = data.telegram_chat_id || '';
        document.getElementById('tg-enabled').checked = !!data.telegram_enabled;
    } catch (e) {
        console.error('Settings load error:', e);
    }
};

// Add Monitor Handlers
const handleAddUrl = async (e) => {
    e.preventDefault();
    const inputUrl = document.getElementById('input-url');
    let url = inputUrl.value.trim();
    if (!url) return;
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    const submitBtn = document.getElementById('btn-submit-url');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> در حال استعلام اولیه...';
    
    try {
        const resp = await fetch('/api/monitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`مسیر ${data.origin_name} به ${data.destination_name} با موفقیت به پایش اضافه شد.`, 'success');
            inputUrl.value = '';
            fetchMonitors();
            selectMonitor(data.id);
        } else {
            showToast(data.detail || 'خطا در ثبت مسیر سفر۷۲۴', 'error');
        }
    } catch (err) {
        showToast('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> شروع پایش مسیر';
    }
};

const handleAddManual = async (e) => {
    e.preventDefault();
    const orig = document.getElementById('input-origin-query').value.trim();
    const dest = document.getElementById('input-dest-query').value.trim();
    const date = document.getElementById('input-manual-date').value.trim();
    
    if (!orig || !dest || !date) return;
    
    try {
        const resp = await fetch('/api/monitors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: orig, destination: dest, date: date })
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(`مسیر ${data.origin_name} به ${data.destination_name} ثبت شد.`, 'success');
            document.getElementById('input-origin-query').value = '';
            document.getElementById('input-dest-query').value = '';
            fetchMonitors();
            selectMonitor(data.id);
        } else {
            showToast(data.detail || 'شهر یا مسیر معتبر نیست.', 'error');
        }
    } catch (err) {
        showToast('خطا در برقراری ارتباط', 'error');
    }
};

// Monitors List Fetch & Render
const fetchMonitors = async (silent = false) => {
    try {
        const resp = await fetch('/api/monitors');
        const monitors = await resp.json();
        
        document.getElementById('monitors-count').textContent = monitors.length;
        const container = document.getElementById('monitors-list');
        
        if (!monitors || monitors.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-compass"></i>
                    <p>هیچ مسیری ثبت نشده است. از کادر بالا لینک مسیر سفر۷۲۴ را اضافه کنید.</p>
                </div>`;
            document.getElementById('buses-container').innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-bus-simple"></i>
                    <p>یک مسیر را اضافه کرده یا از لیست انتخاب کنید تا اتوبوس‌ها و سواری‌های آن نمایش داده شوند.</p>
                </div>`;
            document.getElementById('selected-monitor-label').textContent = 'انتخاب نشده';
            currentMonitorId = null;
            return;
        }
        
        // Auto select first monitor if none selected
        if (!currentMonitorId && monitors.length > 0) {
            currentMonitorId = monitors[0].id;
            fetchServices(currentMonitorId);
        }
        
        container.innerHTML = monitors.map(m => {
            const isSelected = (m.id === currentMonitorId) ? 'selected' : '';
            const isActive = m.active ? 'fa-circle-check text-success' : 'fa-circle-pause text-muted';
            const seatsClass = m.available_seats > 0 ? 'seats-positive' : '';
            const lastCheckTime = m.last_checked ? m.last_checked.split(' ')[1] : 'در حال استعلام...';
            
            return `
                <div class="monitor-card ${isSelected}" onclick="selectMonitor('${m.id}')">
                    <div class="monitor-header">
                        <div class="route-title">
                            <i class="fa-solid fa-location-dot color-primary"></i>
                            <span>${m.origin_name} ➔ ${m.destination_name}</span>
                        </div>
                        <span class="route-date">${m.date}</span>
                    </div>
                    
                    <div class="monitor-stats">
                        <span class="stat-item"><i class="fa-solid fa-bus"></i> کل: ${m.total_buses}</span>
                        <span class="stat-item ${seatsClass}"><i class="fa-solid fa-chair"></i> صندلی خالی: <strong>${m.available_seats}</strong></span>
                    </div>
                    
                    <div class="monitor-footer">
                        <span class="last-check-text">آخرین بررسی: ${lastCheckTime}</span>
                        <div class="monitor-actions" onclick="event.stopPropagation()">
                            <button class="btn btn-icon btn-sm" onclick="triggerCheck('${m.id}')" title="استعلام فوری">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>
                            <button class="btn btn-icon btn-sm" onclick="toggleMonitor('${m.id}')" title="فعال/غیرفعال">
                                <i class="fa-solid ${isActive}"></i>
                            </button>
                            <button class="btn btn-icon btn-sm btn-danger-outline" onclick="deleteMonitor('${m.id}')" title="حذف مسیر">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');
        
    } catch (e) {
        if (!silent) console.error('Fetch monitors error:', e);
    }
};

const selectMonitor = (id) => {
    currentMonitorId = id;
    fetchMonitors(true);
    fetchServices(id);
};

const triggerCheck = async (id) => {
    showToast('در حال استعلام لحظه‌ای...', 'info');
    try {
        const resp = await fetch(`/api/monitors/${id}/check`, { method: 'POST' });
        const data = await resp.json();
        if (data.changes && data.changes.length > 0) {
            playAlarmSound();
            showToast(`تغییر جدید در اتوبوس‌ها مشاهده شد! 🎉`, 'success');
        } else {
            showToast('استعلام انجام شد. تغییری مشاهده نشد.', 'info');
        }
        fetchMonitors(true);
        fetchServices(id);
        fetchHistory();
    } catch (e) {
        showToast('خطا در استعلام', 'error');
    }
};

const toggleMonitor = async (id) => {
    try {
        await fetch(`/api/monitors/${id}/toggle`, { method: 'POST' });
        fetchMonitors(true);
    } catch (e) {
        console.error(e);
    }
};

const deleteMonitor = async (id) => {
    if (!confirm('آیا از حذف این مسیر اطمینان دارید؟')) return;
    try {
        await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
        showToast('مسیر با موفقیت حذف شد.', 'info');
        if (currentMonitorId === id) currentMonitorId = null;
        fetchMonitors();
        if (!currentMonitorId) {
            document.getElementById('buses-container').innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-bus-simple"></i>
                    <p>یک مسیر را از لیست انتخاب کنید.</p>
                </div>`;
        }
    } catch (e) {
        showToast('خطا در حذف مسیر', 'error');
    }
};

const handleRefreshAll = async () => {
    showToast('در حال بروزرسانی تمام مسیرها...', 'info');
    await fetchMonitors();
    if (currentMonitorId) fetchServices(currentMonitorId);
    fetchHistory();
};

// Fetch Services (Buses) for Selected Monitor
const fetchServices = async (monitorId, silent = false) => {
    try {
        const resp = await fetch(`/api/services/${monitorId}`);
        const buses = await resp.json();
        
        const monitorLabel = document.getElementById('selected-monitor-label');
        const monitorsResp = await fetch('/api/monitors');
        const monitors = await monitorsResp.json();
        const mon = monitors.find(m => m.id === monitorId);
        if (mon) {
            monitorLabel.textContent = `${mon.origin_name} ➔ ${mon.destination_name} (${mon.date})`;
        }
        
        cachedBuses = buses || [];
        cachedPurchaseUrl = mon ? mon.url : '';
        renderBuses();
    } catch (e) {
        if (!silent) console.error('Fetch services error:', e);
    }
};

const renderBuses = () => {
    const container = document.getElementById('buses-container');
    const buses = cachedBuses;
    const purchaseUrl = cachedPurchaseUrl;

    if (!Array.isArray(buses) || buses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-bus-slash"></i>
                <p>در حال حاضر هیچ اتوبوس یا سواری برای این مسیر یافت نشد.</p>
            </div>`;
        document.getElementById('count-all').textContent = '0';
        document.getElementById('count-bus').textContent = '0';
        document.getElementById('count-savari').textContent = '0';
        document.getElementById('count-available').textContent = '0';
        return;
    }
    
    // Categorize vehicles
    buses.forEach(b => {
        const bt = String(b.BusType || '');
        const cu = String(b.CompanyUrl || '');
        b.is_savari = bt.includes('سواری') || cu.includes('/savari/');
    });

    const busCount = buses.filter(b => !b.is_savari).length;
    const savariCount = buses.filter(b => b.is_savari).length;
    const availableCount = buses.filter(b => (b.AvailableSeatCount || 0) > 0).length;

    document.getElementById('count-all').textContent = buses.length;
    document.getElementById('count-bus').textContent = busCount;
    document.getElementById('count-savari').textContent = savariCount;
    document.getElementById('count-available').textContent = availableCount;
    
    let filtered = buses;
    if (currentFilter === 'bus') {
        filtered = buses.filter(b => !b.is_savari);
    } else if (currentFilter === 'savari') {
        filtered = buses.filter(b => b.is_savari);
    } else if (currentFilter === 'available') {
        filtered = buses.filter(b => (b.AvailableSeatCount || 0) > 0);
    } else if (currentFilter === 'vip') {
        filtered = buses.filter(b => b.IsVip);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-filter"></i>
                <p>هیچ اتوبوس یا سواری با فیلتر انتخابی مطابقت ندارد.</p>
            </div>`;
        return;
    }
    
    container.innerHTML = filtered.map(b => {
        const seats = b.AvailableSeatCount || 0;
        const seatsBadge = seats > 0 
            ? `<span class="seats-badge seats-available">${seats} صندلی خالی</span>`
            : `<span class="seats-badge seats-full">تکمیل ظرفیت</span>`;
            
        const isSavari = b.is_savari;
        const vehicleBadge = isSavari
            ? `<span class="vehicle-badge vehicle-badge-savari"><i class="fa-solid fa-car"></i> سواری / تاکسی</span>`
            : `<span class="vehicle-badge vehicle-badge-bus"><i class="fa-solid fa-bus"></i> اتوبوس</span>`;

        const vipTag = b.IsVip ? `<span class="bus-vip-tag"><i class="fa-solid fa-star"></i> VIP</span>` : '';
        const priceText = b.Price ? `${b.Price.toLocaleString()} <span>ریال</span>` : 'نامشخص';
        const busTypeDetail = b.BusType ? `<span class="text-dim fs-sm" style="font-size:11px; display:block; color:#94a3b8;">${b.BusType}</span>` : '';

        return `
            <div class="bus-row">
                <div class="bus-row-main">
                    <div class="bus-time">
                        <i class="fa-solid ${isSavari ? 'fa-car color-warning' : 'fa-clock color-primary'}"></i> ${b.DepartureTime}
                    </div>
                    
                    <div class="bus-company">
                        <div class="company-title-row">
                            <span class="company-name">${b.CompanyPersianName}</span>
                            ${vipTag}
                        </div>
                        <div class="company-meta-row">
                            ${vehicleBadge}
                            ${busTypeDetail}
                        </div>
                    </div>
                </div>

                <div class="bus-seats-cell">${seatsBadge}</div>
                
                <div class="bus-row-actions">
                    <div class="bus-price">${priceText}</div>
                    <a href="${purchaseUrl}" target="_blank" class="btn btn-primary btn-sm btn-buy">
                        <i class="fa-solid fa-ticket"></i> خرید بلیط
                    </a>
                </div>
            </div>`;
    }).join('');
};

// History Feed
let lastHistoryCount = 0;
const fetchHistory = async (silent = false) => {
    try {
        const resp = await fetch('/api/history');
        const history = await resp.json();
        
        const container = document.getElementById('history-stream');
        
        if (!history || history.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-bell-slash"></i>
                    <p>هنوز تغییری ثبت نشده است. سیستم هر ۱ دقیقه تغییرات ظرفیت را گزارش می‌کند.</p>
                </div>`;
            return;
        }
        
        // Play sound if new event arrived
        if (history.length > lastHistoryCount && lastHistoryCount > 0) {
            playAlarmSound();
            showToast('تغییر جدید در صندلی اتوبوس پیدا شد!', 'success');
        }
        lastHistoryCount = history.length;
        
        container.innerHTML = history.map(evt => {
            let icon = 'fa-bell';
            if (evt.type === 'NEW_BUS') icon = 'fa-bus';
            if (evt.type === 'CAPACITY_INCREASED') icon = 'fa-arrow-trend-up';
            if (evt.type === 'CAPACITY_DECREASED') icon = 'fa-arrow-trend-down';
            if (evt.type === 'PRICE_CHANGED') icon = 'fa-tags';
            
            return `
                <div class="event-item event-${evt.type}">
                    <div class="event-icon">
                        <i class="fa-solid ${icon}"></i>
                    </div>
                    <div class="event-content">
                        <div class="event-title">${evt.title}</div>
                        <div class="event-desc">${evt.description}</div>
                        <div class="event-time">${evt.timestamp} | مسیر: ${evt.route} (${evt.date})</div>
                    </div>
                </div>`;
        }).join('');
        
    } catch (e) {
        if (!silent) console.error('Fetch history error:', e);
    }
};

const handleClearHistory = async () => {
    try {
        await fetch('/api/history', { method: 'DELETE' });
        lastHistoryCount = 0;
        fetchHistory();
        showToast('تاریخچه پاک‌سازی شد.', 'info');
    } catch (e) {
        showToast('خطا در پاک‌سازی', 'error');
    }
};
