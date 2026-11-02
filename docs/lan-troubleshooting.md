# 手機連不到：Windows 防火牆設定

曾遇到「電腦可以開啟遊戲，但 iPhone 掃碼或輸入網址後無法載入」的情況，調整 Windows 防火牆允許區網連線後即可加入。電腦自己能開啟網址，不代表防火牆已允許其他裝置連入。

先確認以下事項：

1. 電腦已執行 `npm start`（第一次需先 `npm run build`），並保持終端機開啟。
2. 手機與電腦連同一個家用網路，手機不要使用行動網路或訪客 Wi-Fi。
3. 手機使用 QR Code 中的區網網址，例如 `http://10.0.0.101:3000`，不是 `localhost`。可在電腦執行 `ipconfig`，查看目前 Wi-Fi 網卡的 IPv4 位址；不要選 VPN 或虛擬網卡的位址。IP 換了就要使用新的網址。
4. 主持人電腦仍使用 `http://localhost:3000`，題庫管理及房間控制台分別為 `/admin`、`/control`。

### 允許 Windows 防火牆連入

第一次啟動若跳出 Windows 防火牆提示，允許 Node.js 存取目前使用的網路。Windows 的網路設定檔可能是「私人」或「公用」；只勾私人，但目前 Wi-Fi 被判定為公用時，手機仍可能連不到。

若之前沒有允許，請在**主持人電腦**以系統管理員身分開啟 PowerShell，新增只允許本機子網路存取 Node.js TCP 3000 的規則：

```powershell
$songNode = (Get-Command node -ErrorAction Stop).Source
New-NetFirewallRule -DisplayName 'Song Party - Node TCP 3000 LAN' -Direction Inbound -Action Allow -Program $songNode -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet -Profile Private,Public
```

規則同時涵蓋私人與公用設定檔，但來源限制在本機子網路。若程式使用其他連接埠，將 `3000` 改成對應的 `PORT`。更新或重裝 Node.js 導致執行檔路徑改變時，也需要更新規則的程式路徑。

完成後，在手機重新開啟區網網址或重新掃碼測試。這項設定不需要關閉整個防火牆，也不需要設定路由器連接埠轉送。

若仍無法連線，確認路由器沒有啟用 AP／用戶端隔離，並檢查是否有明確封鎖 Node.js 的防火牆規則；明確封鎖可能優先於允許規則。請辨識規則用途後再調整，不要直接刪除系統、安全軟體或開發工具的隔離規則。

不再使用時，可在系統管理員 PowerShell 移除上述規則：

```powershell
Remove-NetFirewallRule -DisplayName 'Song Party - Node TCP 3000 LAN'
```
