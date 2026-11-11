using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

class Program {
    private const int WH_MOUSE_LL = 14;
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private static int clickCount = 0;
    private static int keyCount = 0;

    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);
    private static LowLevelProc mouseProc = MouseHookCallback;
    private static LowLevelProc keyProc = KeyHookCallback;
    private static IntPtr mouseHookId = IntPtr.Zero;
    private static IntPtr keyHookId = IntPtr.Zero;

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int msg = wParam.ToInt32();
            if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN) {
                Interlocked.Increment(ref clickCount);
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

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

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

    static void Main(string[] args) {
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            IntPtr moduleHandle = GetModuleHandle(curModule.ModuleName);
            mouseHookId = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, moduleHandle, 0);
            keyHookId = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, moduleHandle, 0);
        }

        Timer reportTimer = new Timer((e) => {
            int c = Interlocked.Exchange(ref clickCount, 0);
            int k = Interlocked.Exchange(ref keyCount, 0);
            if (c > 0 || k > 0) {
                Console.WriteLine(string.Format("{{\"clicks\":{0},\"keys\":{1}}}", c, k));
            }
        }, null, 500, 500);

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
        }

        reportTimer.Dispose();
        UnhookWindowsHookEx(mouseHookId);
        UnhookWindowsHookEx(keyHookId);
    }
}
