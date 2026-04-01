# past-skies
Weather: past, present and future.

You can use most weather apps to see what the weather is tomorrow; how about what it actually was yesterday, and whether the forecast got it right? This is a mobile app that brings together the actual weather from the past seven days alongside the weather now and the forecast for later.

- **Yesterday's actual weather** — temperature, high/low, precipitation, wind
- **Split hero card** — yesterday's actual side by side with today's forecast
- **Hour by hour strip** — swipe left through the past 12 hours, right through the next 12. Each card is labelled Actual (past) or Forecast (future)
- **Forecast vs actual chart** — a two-line SVG graph overlaying the GFS model's prediction against what the analysis recorded
- **Precipitation chart** — appears automatically when there's rain in the window, comparing predicted vs recorded precipitation as a bar chart
- **Past 7 days** — scrollable daily cards with icon, average temp, high/low, and rainfall
- **7-day forecast** — upcoming days with precipitation probability
- **City search** — search any city worldwide
- **GPS auto-detect** — loads your current location on open
- **°F / °C toggle**
- **Installable as a home screen app** on iPhone and Android via Safari/Chrome → Add to Home Screen

---

## Data sources, explained

**"Actual" past hours** come from Open-Meteo's model analysis, which is a reconstruction of what the atmosphere actually did, assimilated from thousands of real ground stations and satellites worldwide. It isn't raw station readings, but it's very close (typically within 1–2°C of a nearby station).

**"GFS Forecast"** comes from Open-Meteo's historical forecast API — the raw GFS model output from when the forecast was originally issued, before any observation correction. The gap between this and the actual line is real forecast error.

**Future forecast** uses Open-Meteo's standard GFS/ECMWF ensemble, updated hourly.

---

## Running locally

No server needed. Just open `index.html` in a browser.

```bash
open index.html      # macOS
start index.html     # Windows
```

GPS will prompt for permission. If denied, the app defaults to San Francisco.

---

## Privacy

Past Skies does not collect, store, or transmit any personal data.

When you open the app, your browser requests your GPS coordinates directly — these are sent only to the Open-Meteo and OpenStreetMap APIs to fetch weather data for your location. Neither of those services require an account or tie requests to an identity. Your coordinates are never sent to any server I control, never logged, and never shared with third parties.

The app has no backend, no database, no analytics, no cookies, and no tracking of any kind. Nothing persists between sessions. If you search for a city, that search lives only in your browser for the duration of your visit and disappears when you close the tab.

Because the app is a static file hosted on GitHub Pages, even the hosting layer has no visibility into how it's being used.

**tl;dr:** the app doesn't know who you are, doesn't want to, and has no way to find out.

---

## Future plans

I have some new features cooking in the lab. Let me know if there's anything you'd like to see at zeynep@past-skies.com
