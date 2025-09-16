# 🤖 Automated README Updates

This directory contains automation scripts that keep the profile README fresh and engaging with daily updates.

## 📁 Structure

```
.github/
├── workflows/
│   └── update-readme.yml      # GitHub Actions workflow
└── scripts/
    └── update-motivation.js   # Node.js update script
```

## ⚙️ How It Works

### 🕐 Schedule
- **Daily at 6:30 PM UTC** (12:00 AM IST next day)
- Can also be triggered manually via GitHub Actions

### 🔄 What Gets Updated

1. **Motivation Section** (`lines ~310-324`)
   - Random programming quote from a curated collection
   - Mood emoji and description
   - Energy level with coffee cups
   - Daily goal message
   - Status indicator

2. **Learning Journey** (`line ~518`)
   - Updates the `last_updated` timestamp

3. **Footer Badge** (`line ~640`)
   - Updates the "Last Updated" badge timestamp

### 📚 Quote Collection

The script includes 12 carefully selected programming quotes from renowned developers and computer scientists including:
- Martin Fowler
- Brian Kernighan  
- Harold Abelson
- Michael Feathers
- And more!

### 🎲 Randomization

Each update randomly selects:
- 1 of 12 motivational quotes
- 1 of 6 mood states
- 1 of 4 energy levels
- 1 of 6 daily goals
- 1 of 6 status messages

## 🚀 Manual Trigger

You can manually trigger the update by:
1. Going to the **Actions** tab in the repository
2. Selecting the "Update README with Daily Motivation" workflow
3. Clicking "Run workflow"

## 🛠️ Technical Details

- **Language**: Node.js (vanilla JavaScript)
- **Dependencies**: None (uses only Node.js built-ins)
- **Permissions**: `contents: write` for committing changes
- **Git Config**: Uses GitHub Actions bot credentials

The automation ensures the profile stays dynamic and engaging without any manual intervention! ✨