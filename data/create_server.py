# -*- coding: utf-8 -*-
import os
import sys
import json
import asyncio
import time
import ssl
import re
import urllib.request
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
SNAPSHOTS_FILE = os.path.join(DATA_DIR, "snapshots.json")

DEFAULT_CONFIG = {
    "settings": {
        "check_interval": 60,
        "telegram_token": "",
        "telegram_chat_id": "",
        "telegram_enabled": False,
        "sound_alarm": True,
        "notify_on_new": True,
        "notify_on_increase": True,
        "notify_on_decrease": False,
        "notify_on_price": True
    },
    "monitors": []
}

def load_json(file_path: str, default_data: Any) -> Any:
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
    return default_data

def save_json(file_path: str, data: Any):
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving {file_path}: {e}")

config_data = load_json(CONFIG_FILE, DEFAULT_CONFIG)
history_data = load_json(HISTORY_FILE, [])
snapshots_data = load_json(SNAPSHOTS_FILE, {})

cities_cache: List[Dict[str, Any]] = []

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*"
}

class Safar724Client:
    @staticmethod
    def get_cities() -> List[Dict[str, Any]]:
        global cities_cache
        if cities_cache:
            return cities_cache
        try:
            url = "https://safar724.com/route/getcities"
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as resp:
                cities_cache = json.loads(resp.read().decode("utf-8"))
                return cities_cache
        except Exception as e:
            print(f"Error fetching cities: {e}")
            return cities_cache or []

    @staticmethod
    def find_city_by_query(query: str) -> Optional[Dict[str, Any]]:
        cities = Safar724Client.get_cities()
        q = query.strip().lower()
        for c in cities:
            if c.get("Name", "").lower() == q or str(c.get("Code")) == q or c.get("PersianName", "").strip() == q:
                return c
        for c in cities:
            if q in c.get("Name", "").lower() or q in c.get("PersianName", "").lower():
                return c
            for expr in c.get("SearchExpressions", []):
                if q == expr.lower():
                    return c
        return None

    @staticmethod
    def parse_safar724_url(url: str) -> Dict[str, Any]:
        result = {
            "origin_slug": "tehran",
            "destination_slug": "lahijan",
            "date": datetime.now().strftime("%Y-%m-%d"),
            "origin_code": None,
            "destination_code": None,
            "origin_name": None,
            "destination_name": None
        }

        date_match = re.search(r"date=([1-4][0-9]{3}-[0-1][0-9]-[0-3][0-9])", url)
        if date_match:
            result["date"] = date_match.group(1)

        route_match = re.search(r"/bus/([a-zA-Z0-9_-]+)-([a-zA-Z0-9_-]+)", url)
        if route_match:
            result["origin_slug"] = route_match.group(1).lower()
            result["destination_slug"] = route_match.group(2).lower()

        origin_city = Safar724Client.find_city_by_query(result["origin_slug"])
        dest_city = Safar724Client.find_city_by_query(result["destination_slug"])

        if origin_city:
            result["origin_code"] = str(origin_city.get("Code"))
            result["origin_name"] = origin_city.get("PersianName")
        if dest_city:
            result["destination_code"] = str(dest_city.get("Code"))
            result["destination_name"] = dest_city.get("PersianName")

        return result

    @staticmethod
    def fetch_services(origin_code: str, destination_code: str, date_str: str) -> Dict[str, Any]:
        url = f"https://safar724.com/bus/getservices?origin={origin_code}&destination={destination_code}&date={date_str}"
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data

def send_telegram_message(message: str):
    settings = config_data.get("settings", {})
    token = settings.get("telegram_token")
    chat_id = settings.get("telegram_chat_id")
    if not settings.get("telegram_enabled") or not token or not chat_id:
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": False
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as resp:
            pass
    except Exception as e:
        print(f"Error sending Telegram notification: {e}")

def process_monitor_check(monitor_id: str) -> List[Dict[str, Any]]:
    global snapshots_data, history_data

    monitors = config_data.get("monitors", [])
    monitor = next((m for m in monitors if m["id"] == monitor_id), None)
    if not monitor or not monitor.get("active", True):
        return []

    origin_code = monitor.get("origin_code")
    destination_code = monitor.get("destination_code")
    date_str = monitor.get("date")

    if not origin_code or not destination_code:
        url_info = Safar724Client.parse_safar724_url(monitor.get("url", ""))
        origin_code = url_info.get("origin_code")
        destination_code = url_info.get("destination_code")
        if not origin_code or not destination_code:
            print(f"Monitor {monitor_id} missing city codes.")
            return []
        monitor["origin_code"] = origin_code
        monitor["destination_code"] = destination_code
        monitor["origin_name"] = url_info.get("origin_name", monitor.get("origin_name"))
        monitor["destination_name"] = url_info.get("destination_name", monitor.get("destination_name"))

    try:
        raw_resp = Safar724Client.fetch_services(origin_code, destination_code, date_str)
        current_items = raw_resp.get("Items", [])
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        monitor["last_checked"] = now_iso
        monitor["status"] = "OK"
        monitor["total_buses"] = len(current_items)
        available_seats = sum(item.get("AvailableSeatCount", 0) for item in current_items)
        monitor["available_seats"] = available_seats
        save_json(CONFIG_FILE, config_data)

        prev_snapshot = snapshots_data.get(monitor_id, [])
        prev_map = {str(item.get("ID")): item for item in prev_snapshot}
        curr_map = {str(item.get("ID")): item for item in current_items}

        detected_changes = []
        settings = config_data.get("settings", {})

        for bus_id, curr in curr_map.items():
            time_str = curr.get("DepartureTime", "")
            comp_name = curr.get("CompanyPersianName", "")
            price = curr.get("Price", 0)
            curr_seats = curr.get("AvailableSeatCount", 0)
            is_vip = curr.get("IsVip", False)
            bus_type_raw = str(curr.get("BusType", ""))
            company_url = str(curr.get("CompanyUrl", ""))

            # Categorize vehicle type: SAVARI vs BUS
            is_savari = "سواری" in bus_type_raw or "/savari/" in company_url
            vehicle_type_name = "سواری (تاکسی)" if is_savari else "اتوبوس"
            vehicle_icon = "🚗" if is_savari else "🚌"
            curr["vehicle_category"] = "SAVARI" if is_savari else "BUS"

            if bus_id not in prev_map:
                if prev_snapshot and settings.get("notify_on_new", True):
                    change_obj = {
                        "id": f"evt_{int(time.time()*1000)}_{bus_id}",
                        "monitor_id": monitor_id,
                        "timestamp": now_iso,
                        "type": "NEW_BUS",
                        "vehicle_category": curr["vehicle_category"],
                        "title": f"{vehicle_icon} {vehicle_type_name} جدید اضافه شد",
                        "route": f"{monitor['origin_name']} به {monitor['destination_name']}",
                        "date": date_str,
                        "time": time_str,
                        "company": comp_name,
                        "seats": curr_seats,
                        "price": price,
                        "description": f"{vehicle_type_name} ساعت {time_str} شرکت {comp_name} ({bus_type_raw}) با {curr_seats} صندلی به قیمت {price:,} تومان اضافه شد."
                    }
                    detected_changes.append(change_obj)

                    tg_msg = (
                        f"{vehicle_icon} <b>{vehicle_type_name} جدید اضافه شد!</b>
" +
                        f"📍 <b>مسیر:</b> {monitor['origin_name']} ➔ {monitor['destination_name']}
" +
                        f"📅 <b>تاریخ:</b> {date_str}
" +
                        f"⏰ <b>ساعت:</b> {time_str} ({comp_name} - {bus_type_raw})
" +
                        f"🎟️ <b>ظرفیت اولیه:</b> {curr_seats} صندلی
" +
                        f"💵 <b>قیمت:</b> {price:,} تومان
" +
                        f"🔗 <a href='{monitor.get('url')}'>خرید بلیط از سفر۷۲۴</a>"
                    )
                    send_telegram_message(tg_msg)
            else:
                prev = prev_map[bus_id]
                prev_seats = prev.get("AvailableSeatCount", 0)
                prev_price = prev.get("Price", 0)

                if curr_seats > prev_seats and settings.get("notify_on_increase", True):
                    is_zero_to_n = (prev_seats == 0)
                    title = f"🎉 صندلی جدید باز شد! ({vehicle_type_name})" if is_zero_to_n else f"📈 افزایش ظرفیت {vehicle_type_name}"
                    change_obj = {
                        "id": f"evt_{int(time.time()*1000)}_{bus_id}",
                        "monitor_id": monitor_id,
                        "timestamp": now_iso,
                        "type": "CAPACITY_INCREASED",
                        "vehicle_category": curr["vehicle_category"],
                        "title": title,
                        "route": f"{monitor['origin_name']} به {monitor['destination_name']}",
                        "date": date_str,
                        "time": time_str,
                        "company": comp_name,
                        "seats": curr_seats,
                        "prev_seats": prev_seats,
                        "price": price,
                        "description": f"ظرفیت {vehicle_type_name} ساعت {time_str} ({comp_name}) از {prev_seats} به {curr_seats} صندلی افزایش یافت!"
                    }
                    detected_changes.append(change_obj)

                    header_tg = f"🎉 <b>صندلی جدید باز شد! ({vehicle_type_name})</b>
" if is_zero_to_n else f"📈 <b>افزایش ظرفیت {vehicle_type_name}!</b>
"
                    tg_msg = (
                        header_tg +
                        f"📍 <b>مسیر:</b> {monitor['origin_name']} ➔ {monitor['destination_name']}
" +
                        f"📅 <b>تاریخ:</b> {date_str}
" +
                        f"⏰ <b>ساعت:</b> {time_str} ({comp_name} - {bus_type_raw})
" +
                        f"🎟️ <b>ظرفیت جدید:</b> <b>{curr_seats} صندلی</b> (قبلی: {prev_seats})
" +
                        f"💵 <b>قیمت:</b> {price:,} تومان
" +
                        f"🔗 <a href='{monitor.get('url')}'>خرید فوری بلیط از سفر۷۲۴</a>"
                    )
                    send_telegram_message(tg_msg)

                elif curr_seats < prev_seats and settings.get("notify_on_decrease", False):
                    change_obj = {
                        "id": f"evt_{int(time.time()*1000)}_{bus_id}",
                        "monitor_id": monitor_id,
                        "timestamp": now_iso,
                        "type": "CAPACITY_DECREASED",
                        "vehicle_category": curr["vehicle_category"],
                        "title": f"📉 کاهش ظرفیت {vehicle_type_name}",
                        "route": f"{monitor['origin_name']} به {monitor['destination_name']}",
                        "date": date_str,
                        "time": time_str,
                        "company": comp_name,
                        "seats": curr_seats,
                        "prev_seats": prev_seats,
                        "price": price,
                        "description": f"ظرفیت {vehicle_type_name} ساعت {time_str} ({comp_name}) از {prev_seats} به {curr_seats} صندلی کاهش یافت."
                    }
                    detected_changes.append(change_obj)

                if price != prev_price and settings.get("notify_on_price", True):
                    change_obj = {
                        "id": f"evt_{int(time.time()*1000)}_{bus_id}",
                        "monitor_id": monitor_id,
                        "timestamp": now_iso,
                        "type": "PRICE_CHANGED",
                        "vehicle_category": curr["vehicle_category"],
                        "title": f"💰 تغییر قیمت {vehicle_type_name}",
                        "route": f"{monitor['origin_name']} به {monitor['destination_name']}",
                        "date": date_str,
                        "time": time_str,
                        "company": comp_name,
                        "price": price,
                        "prev_price": prev_price,
                        "description": f"قیمت بلیط {vehicle_type_name} ساعت {time_str} ({comp_name}) از {prev_price:,} به {price:,} تومان تغییر کرد."
                    }
                    detected_changes.append(change_obj)

                    tg_msg = (
                        f"💰 <b>تغییر قیمت بلیط {vehicle_type_name}!</b>
" +
                        f"📍 <b>مسیر:</b> {monitor['origin_name']} ➔ {monitor['destination_name']}
" +
                        f"📅 <b>تاریخ:</b> {date_str}
" +
                        f"⏰ <b>ساعت:</b> {time_str} ({comp_name})
" +
                        f"💵 <b>قیمت جدید:</b> {price:,} تومان (قبلی: {prev_price:,})
" +
                        f"🔗 <a href='{monitor.get('url')}'>مشاهده در سفر۷۲۴</a>"
                    )
                    send_telegram_message(tg_msg)

        snapshots_data[monitor_id] = current_items
        save_json(SNAPSHOTS_FILE, snapshots_data)

        if detected_changes:
            history_data.extend(detected_changes)
            history_data = history_data[-500:]
            save_json(HISTORY_FILE, history_data)

        return detected_changes

    except Exception as e:
        print(f"Error checking monitor {monitor_id}: {e}")
        monitor["status"] = "ERROR"
        save_json(CONFIG_FILE, config_data)
        return []

async def background_scheduler():
    while True:
        try:
            monitors = config_data.get("monitors", [])
            interval = config_data.get("settings", {}).get("check_interval", 60)
            for m in monitors:
                if m.get("active", True):
                    process_monitor_check(m["id"])
                    await asyncio.sleep(1)
            await asyncio.sleep(max(10, interval))
        except Exception as e:
            print(f"Error in scheduler loop: {e}")
            await asyncio.sleep(15)

app = FastAPI(title="Safar724 Ticket Monitoring API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    asyncio.get_event_loop().run_in_executor(None, Safar724Client.get_cities)
    asyncio.create_task(background_scheduler())

@app.get("/api/cities")
def get_cities():
    return Safar724Client.get_cities()

@app.get("/api/monitors")
def get_monitors():
    return config_data.get("monitors", [])

@app.post("/api/monitors")
def add_monitor(payload: Dict[str, Any]):
    url = payload.get("url", "").strip()
    origin_query = payload.get("origin", "").strip()
    destination_query = payload.get("destination", "").strip()
    date_str = payload.get("date", "").strip()

    if url:
        parsed = Safar724Client.parse_safar724_url(url)
        origin_code = parsed.get("origin_code")
        destination_code = parsed.get("destination_code")
        origin_name = parsed.get("origin_name") or parsed.get("origin_slug")
        destination_name = parsed.get("destination_name") or parsed.get("destination_slug")
        if not date_str:
            date_str = parsed.get("date")
    else:
        orig_city = Safar724Client.find_city_by_query(origin_query)
        dest_city = Safar724Client.find_city_by_query(destination_query)
        if not orig_city or not dest_city:
            raise HTTPException(status_code=400, detail="شهر مبدا یا مقصد پیدا نشد.")
        origin_code = str(orig_city.get("Code"))
        destination_code = str(dest_city.get("Code"))
        origin_name = orig_city.get("PersianName")
        destination_name = dest_city.get("PersianName")
        url = f"https://safar724.com/bus/{orig_city.get('Name')}-{dest_city.get('Name')}?date={date_str}"

    monitor_id = f"mon_{int(time.time())}"
    new_monitor = {
        "id": monitor_id,
        "url": url,
        "origin_code": origin_code,
        "destination_code": destination_code,
        "origin_name": origin_name,
        "destination_name": destination_name,
        "date": date_str,
        "active": True,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "last_checked": None,
        "total_buses": 0,
        "available_seats": 0,
        "status": "PENDING"
    }

    config_data["monitors"].append(new_monitor)
    save_json(CONFIG_FILE, config_data)

    process_monitor_check(monitor_id)
    return new_monitor

@app.delete("/api/monitors/{monitor_id}")
def delete_monitor(monitor_id: str):
    monitors = config_data.get("monitors", [])
    config_data["monitors"] = [m for m in monitors if m["id"] != monitor_id]
    save_json(CONFIG_FILE, config_data)
    if monitor_id in snapshots_data:
        del snapshots_data[monitor_id]
        save_json(SNAPSHOTS_FILE, snapshots_data)
    return {"status": "success"}

@app.post("/api/monitors/{monitor_id}/toggle")
def toggle_monitor(monitor_id: str):
    monitors = config_data.get("monitors", [])
    for m in monitors:
        if m["id"] == monitor_id:
            m["active"] = not m.get("active", True)
            save_json(CONFIG_FILE, config_data)
            return {"status": "success", "active": m["active"]}
    raise HTTPException(status_code=404, detail="Monitor not found")

@app.post("/api/monitors/{monitor_id}/check")
def trigger_check(monitor_id: str):
    changes = process_monitor_check(monitor_id)
    return {"status": "success", "changes": changes}

@app.get("/api/services/{monitor_id}")
def get_services(monitor_id: str):
    snapshot = snapshots_data.get(monitor_id, [])
    return snapshot

@app.get("/api/history")
def get_history():
    return list(reversed(history_data))

@app.delete("/api/history")
def clear_history():
    global history_data
    history_data = []
    save_json(HISTORY_FILE, history_data)
    return {"status": "success"}

@app.get("/api/settings")
def get_settings():
    return config_data.get("settings", {})

@app.post("/api/settings")
def update_settings(payload: Dict[str, Any]):
    settings = config_data.get("settings", {})
    settings.update(payload)
    config_data["settings"] = settings
    save_json(CONFIG_FILE, config_data)
    return settings

@app.post("/api/test-telegram")
def test_telegram():
    settings = config_data.get("settings", {})
    token = settings.get("telegram_token")
    chat_id = settings.get("telegram_chat_id")
    if not token or not chat_id:
        raise HTTPException(status_code=400, detail="لطفا Token و Chat ID ربات تلگرام را وارد کنید.")

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": "🧪 <b>تست سیستم اطلاع‌رسانی بلیط سفر۷۲۴</b>

ربات تلگرام با موفقیت متصل شد و آماده ارسال هشدارهای آنی می‌باشد! 🚀",
        "parse_mode": "HTML"
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            if res_data.get("ok"):
                return {"status": "success", "message": "پیام آزمایشی به تلگرام ارسال شد!"}
            else:
                raise HTTPException(status_code=400, detail=res_data.get("description", "خطا در ارسال پیام"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"خطا در ارتباط با تلگرام: {str(e)}")

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
