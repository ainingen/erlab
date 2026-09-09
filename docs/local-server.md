# ERLAB ローカルサーバー手順表（PowerShell）

リポジトリ：`C:\dev\erlab`　　サーバー：`http://localhost:8000/`

---

## 1. 毎回の流れ（コピペ用）

```powershell
cd C:\dev\erlab
git checkout main
git pull
git log -1 --oneline
python -m http.server 8000
```

- 4行目で出たハッシュが、Code が最後に報告した main のハッシュと同じなら最新
- 5行目で `Serving HTTP on :: port 8000` と出たら起動。**このウィンドウは閉じない**（閉じるとサーバーが止まる）
- ブラウザで `http://localhost:8000/` を開く。前に開いていたなら **Ctrl+Shift+R**（強制再読み込み）

止めるとき：サーバーのウィンドウで **Ctrl+C**

---

## 2. 開く場所

| 見たいもの | URL |
|---|---|
| ゲーム | `http://localhost:8000/` |
| テスト | `http://localhost:8000/test/` |
| ファイルが配られているか確認 | `http://localhost:8000/src/investigate.js`（コードが出れば OK、404 なら別フォルダを配っている） |

---

## 3. スマホで見る（同じ Wi-Fi）

PC でもう一つ PowerShell を開いて：

```powershell
ipconfig
```

「IPv4 アドレス」の `192.168.x.x` を控える。スマホのブラウザで：

```
http://192.168.x.x:8000/
```

- 開けないときは Windows のファイアウォールが 8000 を止めている。初回起動時に出た「アクセスを許可しますか」で許可していなければ、
  設定 → ファイアウォール → 「アプリにファイアウォール経由の通信を許可」で Python にプライベートネットワークの許可を付ける
- スマホ側も再読み込みが甘い。開き直しても古いときは、タブを閉じて新しいタブで開く

---

## 4. よくある詰まり

| 症状 | 原因 | 直し方 |
|---|---|---|
| `git pull` しても古いハッシュ | 別ブランチにいる（`git status` の1行目が `On branch main` 以外） | `git checkout main` → `git pull` |
| `git pull` が「would be overwritten」で止まる | 手元に未コミットの同名ファイル（仕様書を置いた直後など） | そのファイルを消す（GitHub から同じものが降りてくる）→ `git pull` |
| 画面が古いまま。ボタンが出ない | ブラウザのキャッシュ | **Ctrl+Shift+R**。駄目なら F12 → Network → 「Disable cache」にチェック → 再読み込み |
| フォルダ一覧が表示される／404 | サーバーを立てた場所が違う | Ctrl+C で止めて `cd C:\dev\erlab` してから再起動 |
| `python` が見つからない | 名前が違う | `py -m http.server 8000` |
| `Address already in use` | 8000 が使用中（前のサーバーが生きている） | 前のウィンドウで Ctrl+C。見つからなければ `python -m http.server 8080` にして URL も 8080 に |
| 白い画面・何も出ない | file:// で開いている | 必ず `http://localhost:8000/` から開く |

---

## 5. 実機確認のチェック順（新しい機能が入ったとき）

1. `git log -1 --oneline` が Code の報告どおりのハッシュか
2. `http://localhost:8000/test/` が全部 PASS か（件数も報告と合うか）
3. 症例0を通す（新しいステップが入っているか、台詞の長さ）
4. 変更のあった症例を通す（best の道と、降格の道の両方）
5. スマホ縦で横あふれがないか（横スクロールが出たら NG）

---

## 6. 手元を汚さない約束

- 手元のフォルダで直接ファイルを直さない（Code とぶつかる）。直したいことはチャット → 仕様書 → Code の順
- 仕様書を `docs\` に置くのは Code に渡すときだけ。渡したら `git pull` の前に消す（上の表の2行目）
- `git checkout main` で「local changes would be overwritten」と言われたら、何かを手で直している。`git status` で見て、要らなければ `git checkout -- <ファイル名>` で元に戻す
