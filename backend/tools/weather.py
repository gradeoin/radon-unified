"""
Radon Unified — Agentic Tool: Real-Time Weather
Uses Open-Meteo (free, no key required) with geocoding.
Ported from radon/worker/worker.js fetchRealWeather().
"""
import urllib.parse
from typing import Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

TOOL_DEFINITION = {
    "name": "get_weather",
    "description": "Get real-time weather conditions and forecast for any city.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "city":      {"type": "STRING", "description": "The city name e.g. Mumbai, New York"},
            "latitude":  {"type": "NUMBER", "description": "Latitude of the city (optional)"},
            "longitude": {"type": "NUMBER", "description": "Longitude of the city (optional)"},
        },
        "required": ["city"]
    }
}

WEATHER_CODES = {
    0: "Clear sky ☀️", 1: "Mainly clear 🌤️", 2: "Partly cloudy ⛅", 3: "Overcast ☁️",
    45: "Foggy 🌫️", 48: "Rime fog 🌫️",
    51: "Light drizzle 🌦️", 53: "Moderate drizzle 🌦️", 55: "Heavy drizzle 🌧️",
    61: "Slight rain 🌧️", 63: "Moderate rain 🌧️", 65: "Heavy rain 🌧️",
    71: "Slight snow 🌨️", 73: "Moderate snow 🌨️", 75: "Heavy snow ❄️",
    77: "Snow grains ❄️",
    80: "Rain showers 🌦️", 81: "Moderate showers 🌧️", 82: "Violent showers ⛈️",
    85: "Snow showers 🌨️", 86: "Heavy snow showers ❄️",
    95: "Thunderstorm ⛈️", 96: "Hail thunderstorm ⛈️", 99: "Heavy hail thunderstorm ⛈️",
}


async def run(city: str, latitude: Optional[float] = None, longitude: Optional[float] = None) -> str:
    try:
        if not latitude or not longitude:
            geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(city)}&count=1"
            if HAS_HTTPX:
                async with httpx.AsyncClient(timeout=10) as client:
                    geo_resp = await client.get(geo_url)
                    geo_data = geo_resp.json()
            else:
                import urllib.request, json
                with urllib.request.urlopen(geo_url, timeout=10) as r:
                    geo_data = json.loads(r.read())

            results = geo_data.get("results", [])
            if not results:
                return f'Could not find location for city: "{city}".'
            latitude = results[0]["latitude"]
            longitude = results[0]["longitude"]
            resolved_name = results[0].get("name", city)
            country = results[0].get("country", "")
        else:
            resolved_name = city
            country = ""

        weather_url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={latitude}&longitude={longitude}"
            f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
            f"weather_code,wind_speed_10m,precipitation"
            f"&daily=temperature_2m_max,temperature_2m_min,weather_code"
            f"&timezone=auto&forecast_days=3"
        )
        if HAS_HTTPX:
            async with httpx.AsyncClient(timeout=10) as client:
                w_resp = await client.get(weather_url)
                w = w_resp.json()
        else:
            import urllib.request, json
            with urllib.request.urlopen(weather_url, timeout=10) as r:
                w = json.loads(r.read())

        c = w["current"]
        condition = WEATHER_CODES.get(c.get("weather_code", 0), "Unknown conditions")
        location_str = f"{resolved_name}{', ' + country if country else ''}"

        result = (
            f"🌍 **Weather in {location_str}**\n\n"
            f"**Condition:** {condition}\n"
            f"**Temperature:** {c['temperature_2m']}°C (feels like {c['apparent_temperature']}°C)\n"
            f"**Humidity:** {c['relative_humidity_2m']}%\n"
            f"**Wind:** {c['wind_speed_10m']} km/h\n"
            f"**Precipitation:** {c.get('precipitation', 0)} mm\n\n"
            f"**3-Day Forecast:**\n"
        )
        daily = w.get("daily", {})
        for i, day in enumerate(daily.get("time", [])[:3]):
            day_code = (daily.get("weather_code") or [0, 0, 0])[i]
            day_condition = WEATHER_CODES.get(day_code, "")
            t_max = daily["temperature_2m_max"][i]
            t_min = daily["temperature_2m_min"][i]
            result += f"• **{day}** — {day_condition} | High: {t_max}°C / Low: {t_min}°C\n"

        return result

    except Exception as e:
        return f"Weather fetch error: {e}"
