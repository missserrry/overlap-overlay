# Снимок окна панели вместе с системными кнопками (их нет в снимке страницы).
# Через PrintWindow: снимается само окно, даже если его перекрывают другие окна, —
# в кадр никогда не попадает чужое содержимое экрана.
# Запуск: powershell -File design/capture-window.ps1 -Out <png>
param([string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[Win]::SetProcessDPIAware() | Out-Null
$p = Get-Process electron, 'Svoy Overlay' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Свой оверлей' } | Select-Object -First 1
if (-not $p) { Write-Error 'окно панели не найдено'; exit 1 }
$h = $p.MainWindowHandle
$full = New-Object Win+RECT; [Win]::GetWindowRect($h, [ref]$full) | Out-Null
$vis = New-Object Win+RECT;  [Win]::DwmGetWindowAttribute($h, 9, [ref]$vis, 16) | Out-Null   # видимые границы без невидимой рамки
$fw = $full.R - $full.L; $fh = $full.B - $full.T
$bmp = New-Object System.Drawing.Bitmap $fw, $fh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win]::PrintWindow($h, $hdc, 2)   # PW_RENDERFULLCONTENT — нужен для окон Chromium
$g.ReleaseHdc($hdc)
if (-not $ok) { Write-Error 'PrintWindow не сработал'; exit 1 }
$crop = New-Object System.Drawing.Rectangle ($vis.L - $full.L), ($vis.T - $full.T), ($vis.R - $vis.L), ($vis.B - $vis.T)
$img = $bmp.Clone($crop, $bmp.PixelFormat)
$img.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"saved $Out ($($crop.Width) x $($crop.Height))"
