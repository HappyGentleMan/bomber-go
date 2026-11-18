# Push to GitHub (one-time, needs a GUI keychain approval)

Run this from a normal Terminal on your Mac. It will:
1. Ask for keychain approval (click **Always Allow** if a dialog appears)
2. Create `github.com/HappyGentleMan/bomber-go` (if it doesn't exist)
3. Push all commits

```sh
zsh /Users/anson/.local/share/opencode/gh-setup.sh
```

If the repo name is taken, edit the name inside the script.
