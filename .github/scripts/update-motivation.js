const fs = require('fs');
const path = require('path');

// Programming quotes for daily motivation
const quotes = [
    {
        quote: "Code is like humor. When you have to explain it, it's bad.",
        author: "Cory House"
    },
    {
        quote: "First, solve the problem. Then, write the code.",
        author: "John Johnson"
    },
    {
        quote: "Programming isn't about what you know; it's about what you can figure out.",
        author: "Chris Pine"
    },
    {
        quote: "The best error message is the one that never shows up.",
        author: "Thomas Fuchs"
    },
    {
        quote: "Clean code always looks like it was written by someone who cares.",
        author: "Michael Feathers"
    },
    {
        quote: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
        author: "Martin Fowler"
    },
    {
        quote: "Programs must be written for people to read, and only incidentally for machines to execute.",
        author: "Harold Abelson"
    },
    {
        quote: "The most important property of a program is whether it accomplishes the intention of its user.",
        author: "C.A.R. Hoare"
    },
    {
        quote: "Debugging is twice as hard as writing the code in the first place.",
        author: "Brian Kernighan"
    },
    {
        quote: "Code never lies, comments sometimes do.",
        author: "Ron Jeffries"
    },
    {
        quote: "The best way to get a project done faster is to start sooner.",
        author: "Jim Highsmith"
    },
    {
        quote: "Ready to change the world, one commit at a time!",
        author: "Developer Mindset"
    }
];

// Moods and energy levels
const moods = ["💪 Determined", "🔥 Motivated", "⚡ Energetic", "🚀 Ready", "✨ Inspired", "🎯 Focused"];
const energyLevels = ["☕☕☕☕ High", "☕☕☕☕☕ Maximum", "☕☕☕ Good", "☕☕☕☕⚡ Supercharged"];
const goals = [
    "Build something amazing today!",
    "Turn ideas into reality!",
    "Code the future!",
    "Create something beautiful!",
    "Solve problems with code!",
    "Make an impact through technology!"
];
const statuses = ["🚀 Ready to code!", "💻 In the zone!", "🔥 On fire!", "⚡ Supercharged!", "✨ Feeling creative!", "🎯 Laser focused!"];

function getCurrentDateTime() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toISOString().split('T')[1].split('.')[0] + ' UTC';
    return { date, time };
}

function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function updateReadme() {
    const readmePath = path.join(__dirname, '../../README.md');
    let content = fs.readFileSync(readmePath, 'utf8');
    
    const { date, time } = getCurrentDateTime();
    const selectedQuote = getRandomElement(quotes);
    const selectedMood = getRandomElement(moods);
    const selectedEnergy = getRandomElement(energyLevels);
    const selectedGoal = getRandomElement(goals);
    const selectedStatus = getRandomElement(statuses);
    
    // Update the motivation section (lines around 310-324)
    const motivationRegex = /```javascript\n\/\/ Today's Motivation - Updated: [\d\-\s:UTC]+\nconst motivation = \{[\s\S]*?\};\n\nconsole\.log\(`\$\{motivation\.quote\} - \$\{motivation\.author\}`\);\n\/\/ Output: [\s\S]*?\n```/;
    
    const newMotivation = `\`\`\`javascript
// Today's Motivation - Updated: ${date} ${time}
const motivation = {
    date: "${date}",
    time: "${time}",
    quote: "${selectedQuote.quote}",
    author: "${selectedQuote.author}",
    mood: "${selectedMood}",
    energy: "${selectedEnergy}",
    goal: "${selectedGoal}",
    status: "${selectedStatus}"
};

console.log(\`\${motivation.quote} - \${motivation.author}\`);
// Output: Ready to change the world, one commit at a time! 🌍
\`\`\``;
    
    content = content.replace(motivationRegex, newMotivation);
    
    // Update the learning journey last_updated field
    const learningRegex = /last_updated: "[\d\-\s:UTC]+"/;
    content = content.replace(learningRegex, `last_updated: "${date} ${time}"`);
    
    // Update the footer timestamp
    const footerRegex = /<img src="https:\/\/img\.shields\.io\/badge\/Last_Updated-[\d\-\s:_UTC]+-blue\?style=flat&logo=clock" alt="Last Updated"\/>/;
    const newFooterTimestamp = `<img src="https://img.shields.io/badge/Last_Updated-${date.replace(/-/g, '--')}_${time.replace(/:/g, ':').replace(/ /g, '_')}-blue?style=flat&logo=clock" alt="Last Updated"/>`;
    content = content.replace(footerRegex, newFooterTimestamp);
    
    // Write the updated content back to the file
    fs.writeFileSync(readmePath, content, 'utf8');
    
    console.log('✅ README.md updated successfully!');
    console.log(`📅 Date: ${date}`);
    console.log(`⏰ Time: ${time}`);
    console.log(`💭 Quote: "${selectedQuote.quote}" - ${selectedQuote.author}`);
    console.log(`😄 Mood: ${selectedMood}`);
    console.log(`⚡ Energy: ${selectedEnergy}`);
    console.log(`🎯 Goal: ${selectedGoal}`);
    console.log(`🚀 Status: ${selectedStatus}`);
}

// Run the update
updateReadme();