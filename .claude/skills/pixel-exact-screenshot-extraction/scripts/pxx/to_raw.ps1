# PNG → 不壓縮的 BGR（透明的地方墊白）。檔名帶寬高：<stem>__<W>x<H>.bgr
param([Parameter(Mandatory=$true)][string]$Src, [Parameter(Mandatory=$true)][string]$OutDir)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null
$item = Get-Item -LiteralPath $Src
$img = New-Object System.Drawing.Bitmap $item.FullName
$bmp = New-Object System.Drawing.Bitmap $img.Width, $img.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
# 一定要指定寬高：不指定的話 DrawImage 會照圖檔裡寫的 DPI 縮放，像素就不是原來那幾個了
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White); $g.DrawImage($img, 0, 0, $img.Width, $img.Height); $g.Dispose()
$rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
$d = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$buf = New-Object byte[] ($bmp.Width * $bmp.Height * 3)
for ($y = 0; $y -lt $bmp.Height; $y++) {
  # 每一列後面有對齊用的填充（Stride），不能整塊複製
  [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($d.Scan0.ToInt64() + $y * $d.Stride), $buf, $y * $bmp.Width * 3, $bmp.Width * 3)
}
$bmp.UnlockBits($d)
$name = "{0}__{1}x{2}.bgr" -f $item.BaseName, $bmp.Width, $bmp.Height
[System.IO.File]::WriteAllBytes((Join-Path $OutDir $name), $buf)
"{0} dpi={1}x{2} fmt={3}" -f $name, $img.HorizontalResolution, $img.VerticalResolution, $img.PixelFormat
$bmp.Dispose(); $img.Dispose()
