貼進專案 `CLAUDE.md` 的「環境」或同類的一節（一行就好；雲端 session 不讀全域的 `~/.claude/CLAUDE.md`，所以專案要有自己這一行）：

- 動到已經存在、別處在用的程式碼之前，以及修完 bug 之後，照 `ripple-check` skill 查牽連、找同一個形狀的缺陷（CodeGraph、ast-grep；文件與決定查 graphify 的圖）。

`.gitignore` 加：

```
graphify-out/
.codegraph/
```
