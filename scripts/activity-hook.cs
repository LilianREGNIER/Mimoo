using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice(string id, out IMMDevice endpoint);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
}

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
}

class Program {
    private const int WH_MOUSE_LL = 14;
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private static int clickCount = 0;
    private static int keyCount = 0;
    private static bool isLeftMouseDown = false;
    private static long lastEmitTimestamp = 0;
    private static readonly Stopwatch emitStopwatch = Stopwatch.StartNew();
    private static string lastWindowJson = "null";
    private static string lastValidWindowJson = "null";
    private static bool lastMusicState = false;
    private static int heartbeatTick = 0;
    private static int musicSilenceCounter = 0;
    private static int cachedShadowMargin = 7;

    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelProc mouseProc = MouseHookCallback;
    private static LowLevelProc keyProc = KeyHookCallback;
    private static IntPtr mouseHookId = IntPtr.Zero;
    private static IntPtr keyHookId = IntPtr.Zero;

    private delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);
    private static WinEventDelegate winEventProc = WinEventCallback;
    private static IntPtr winEventHookId = IntPtr.Zero;

    private const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const int OBJID_WINDOW = 0;

    private static IAudioMeterInformation audioMeter = null;

    private static void EmitWindowIfChanged(bool force = false) {
        long now = emitStopwatch.ElapsedMilliseconds;
        if (!force && (now - lastEmitTimestamp < 4)) {
            return;
        }
        string wJson = GetForegroundWindowJson();
        if (wJson != "null" && wJson != lastWindowJson) {
            lastWindowJson = wJson;
            lastValidWindowJson = wJson;
            lastEmitTimestamp = now;
            Console.WriteLine("{\"window\":" + wJson + "}");
            Console.Out.Flush();
        }
    }

    private static void WinEventCallback(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
        if (eventType == EVENT_OBJECT_LOCATIONCHANGE && idObject == OBJID_WINDOW && hwnd != IntPtr.Zero) {
            IntPtr fg = GetForegroundWindow();
            if (hwnd == fg) {
                EmitWindowIfChanged(true);
            }
        }
    }

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int msg = wParam.ToInt32();
            bool isPhysicallyDown = (GetAsyncKeyState(0x01) & 0x8000) != 0;

            if (msg == WM_LBUTTONDOWN) {
                isLeftMouseDown = true;
                Interlocked.Increment(ref clickCount);
                EmitWindowIfChanged(true);
            } else if (msg == WM_LBUTTONUP) {
                isLeftMouseDown = false;
                EmitWindowIfChanged(true);
            } else if (msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN) {
                Interlocked.Increment(ref clickCount);
            } else if (msg == WM_MOUSEMOVE && (isLeftMouseDown || isPhysicallyDown)) {
                // Dès que la souris bouge avec le bouton gauche appuyé (glissement physique de fenêtre),
                // on émet la nouvelle géométrie instantanément sans aucun délai de timer !
                EmitWindowIfChanged(false);
            }
        }
        return CallNextHookEx(mouseHookId, nCode, wParam, lParam);
    }

    private static IntPtr KeyHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
                Interlocked.Increment(ref keyCount);
            }
        }
        return CallNextHookEx(keyHookId, nCode, wParam, lParam);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    private static bool hasMusicKeywords = false;
    private static bool isSpotifyPlayingTrack = false;

    private static readonly string[] MusicKeywords = new string[] {
        "youtube music",
        "music.youtube",
        "youtube",
        "spotify",
        "deezer",
        "soundcloud",
        "apple music",
        "tidal",
        "qobuz",
        "amazon music",
        "pandora",
        "bandcamp",
        "foobar",
        "winamp",
        "aimp",
        "vlc"
    };

    private static bool CheckMusicCallback(IntPtr hWnd, IntPtr lParam) {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, 512);
        string raw = sb.ToString();
        if (string.IsNullOrEmpty(raw) || raw.Length < 3) return true;

        string lower = raw.ToLowerInvariant();

        for (int i = 0; i < MusicKeywords.Length; i++) {
            if (lower.Contains(MusicKeywords[i])) {
                hasMusicKeywords = true;
                if (lower.Contains("spotify") && raw.Contains(" - ")) {
                    isSpotifyPlayingTrack = true;
                }
                break;
            }
        }

        return true;
    }

    private static void InitCoreAudio() {
        try {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            // 0 = eRender, 1 = eMultimedia
            int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            if (hr == 0 && device != null) {
                Guid meterIid = typeof(IAudioMeterInformation).GUID;
                object meterObj;
                hr = device.Activate(ref meterIid, 23, IntPtr.Zero, out meterObj);
                if (hr == 0 && meterObj != null) {
                    audioMeter = (IAudioMeterInformation)meterObj;
                }
            }
        } catch {
            audioMeter = null;
        }
    }

    private static float GetCurrentAudioPeak() {
        if (audioMeter == null) {
            InitCoreAudio();
        }
        if (audioMeter != null) {
            try {
                float peak = 0;
                int hr = audioMeter.GetPeakValue(out peak);
                if (hr == 0) return peak;
            } catch {
                audioMeter = null;
            }
        }
        return 0f;
    }

    private static string GetForegroundWindowJson() {
        try {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero) {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(fg, sb, 256);
                string rawTitle = sb.ToString().Trim();

                bool isOwnApp = rawTitle.IndexOf("Tamagotchi", StringComparison.OrdinalIgnoreCase) >= 0;
                bool isSystem = rawTitle == "Program Manager" || rawTitle == "Desktop" || string.IsNullOrEmpty(rawTitle);

                if (!isOwnApp && !isSystem) {
                    RECT r = new RECT();
                    if (!GetWindowRect(fg, out r)) return lastValidWindowJson;

                    bool isDragging = isLeftMouseDown || ((GetAsyncKeyState(0x01) & 0x8000) != 0);

                    // Si pas en train de glisser, on mesure la bordure invisible d'ombre portée DWM
                    if (!isDragging) {
                        RECT dwmR = new RECT();
                        int hr = -1;
                        try {
                            hr = DwmGetWindowAttribute(fg, DWMWA_EXTENDED_FRAME_BOUNDS, out dwmR, Marshal.SizeOf(typeof(RECT)));
                        } catch {
                            hr = -1;
                        }
                        if (hr == 0 && dwmR.Right > dwmR.Left && dwmR.Bottom > dwmR.Top) {
                            cachedShadowMargin = Math.Max(0, dwmR.Left - r.Left);
                            r = dwmR;
                        }
                    } else {
                        // En plein glissement de fenêtre, GetWindowRect est synchrone avec le noyau Windows à 0 ms de délai !
                        r.Left += cachedShadowMargin;
                        r.Right -= cachedShadowMargin;
                        r.Bottom -= cachedShadowMargin;
                    }

                    int rawW = r.Right - r.Left;
                    int rawH = r.Bottom - r.Top;
                    if (rawW >= 160 && rawH >= 100 && r.Left > -10000 && r.Top > -10000) {
                        // Utilisation directe des coordonnées réelles sans clamping à 0, pour supporter
                        // les bordures d'écran, le snapping Windows et le multi-écran sans distorsion.
                        int x = r.Left;
                        int y = r.Top;
                        int w = Math.Max(160, rawW);
                        int h = Math.Max(100, rawH);

                        string safeTitle = rawTitle
                            .Replace("\\", "\\\\")
                            .Replace("\"", "\\\"")
                            .Replace("\r", "")
                            .Replace("\n", "");

                        return string.Format(
                            "{{\"title\":\"{0}\",\"x\":{1},\"y\":{2},\"width\":{3},\"height\":{4}}}",
                            safeTitle, x, y, w, h
                        );
                    }
                }
            }
        } catch {}
        return lastValidWindowJson;
    }

    static void Main(string[] args) {
        InitCoreAudio();

        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            IntPtr moduleHandle = GetModuleHandle(curModule.ModuleName);
            mouseHookId = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, moduleHandle, 0);
            keyHookId = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, moduleHandle, 0);
            try {
                winEventHookId = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT);
            } catch {}
        }

        // 1. Suivi haute fréquence (~125 Hz, 8 ms) pour les déplacements clavier (Win+Flèches), restaurations, et animations
        // Les glissements à la souris et WinEvents sont traités instantanément sans aucun délai.
        Timer windowTimer = new Timer((e) => {
            EmitWindowIfChanged(false);
        }, null, 8, 8);

        // 2. Échantillonnage d'activité et musique toutes les 500 ms
        Timer reportTimer = new Timer((e) => {
            int c = Interlocked.Exchange(ref clickCount, 0);
            int k = Interlocked.Exchange(ref keyCount, 0);
            heartbeatTick++;

            string windowJson = GetForegroundWindowJson();
            if (windowJson != "null") {
                lastValidWindowJson = windowJson;
            }

            // Détection de musique (Fenêtres + Audio Peak Meter Windows Core Audio)
            hasMusicKeywords = false;
            isSpotifyPlayingTrack = false;
            try {
                EnumWindows(CheckMusicCallback, IntPtr.Zero);
            } catch {}

            float peak = GetCurrentAudioPeak();
            bool isSoundActive = (peak > 0.005f);

            bool isMusicNow = false;
            if (isSpotifyPlayingTrack) {
                isMusicNow = true;
            } else if (hasMusicKeywords && isSoundActive) {
                isMusicNow = true;
            } else if (hasMusicKeywords && peak > 0.002f) {
                isMusicNow = true;
            }

            // Anti-rebond (debounce) : si la musique s'arrête, attendre 3 secondes de silence (6 ticks) avant de couper
            bool effectiveMusicState = isMusicNow;
            if (isMusicNow) {
                musicSilenceCounter = 0;
                effectiveMusicState = true;
            } else {
                if (lastMusicState && musicSilenceCounter < 6) {
                    musicSilenceCounter++;
                    effectiveMusicState = true;
                } else {
                    effectiveMusicState = false;
                }
            }

            bool hasActivity = (c > 0 || k > 0);
            bool musicChanged = (effectiveMusicState != lastMusicState);
            bool heartbeat = (heartbeatTick >= 4); // Heartbeat toutes les 2s

            if (hasActivity || musicChanged || heartbeat) {
                heartbeatTick = 0;
                lastMusicState = effectiveMusicState;

                Console.WriteLine(string.Format(
                    "{{\"clicks\":{0},\"keys\":{1},\"music\":{2}}}",
                    c, k, effectiveMusicState ? "true" : "false"
                ));
                Console.Out.Flush();
            }
        }, null, 500, 500);

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
        }

        windowTimer.Dispose();
        reportTimer.Dispose();
        if (winEventHookId != IntPtr.Zero) {
            try { UnhookWinEvent(winEventHookId); } catch {}
        }
        UnhookWindowsHookEx(mouseHookId);
        UnhookWindowsHookEx(keyHookId);
    }
}
