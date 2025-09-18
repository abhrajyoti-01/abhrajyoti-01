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
    },
    {
        quote: "Talk is cheap. Show me the code.",
        author: "Linus Torvalds"
    },
    {
        quote: "The only way to learn a new programming language is by writing programs in it.",
        author: "Dennis Ritchie"
    },
    {
        quote: "It's not a bug – it's an undocumented feature.",
        author: "Anonymous"
    },
    {
        quote: "Simplicity is the ultimate sophistication.",
        author: "Leonardo da Vinci"
    },
    {
        quote: "Make it work, make it right, make it fast.",
        author: "Kent Beck"
    },
    {
        quote: "The best code is no code at all.",
        author: "Jeff Atwood"
    },
    {
        quote: "Programming is thinking, not typing.",
        author: "Casey Patton"
    },
    {
        quote: "Good code is its own best documentation.",
        author: "Steve McConnell"
    },
    {
        quote: "The computer was born to solve problems that did not exist before.",
        author: "Bill Gates"
    },
    {
        quote: "Software is a great combination between artistry and engineering.",
        author: "Bill Gates"
    },
    {
        quote: "The best way to predict the future is to implement it.",
        author: "Alan Kay"
    },
    {
        quote: "Innovation distinguishes between a leader and a follower.",
        author: "Steve Jobs"
    },
    {
        quote: "Code is poetry written in logic.",
        author: "Anonymous"
    },
    {
        quote: "Every great developer you know got there by solving problems they were unqualified to solve until they actually did it.",
        author: "Patrick McKenzie"
    },
    {
        quote: "The function of good software is to make the complex appear to be simple.",
        author: "Grady Booch"
    },
    {
        quote: "Programming is not about typing, it's about thinking.",
        author: "Rich Hickey"
    },
    {
        quote: "The most disastrous thing that you can ever learn is your first programming language.",
        author: "Alan Kay"
    },
    {
        quote: "Measuring programming progress by lines of code is like measuring aircraft building progress by weight.",
        author: "Bill Gates"
    },
    {
        quote: "There are only two hard things in Computer Science: cache invalidation and naming things.",
        author: "Phil Karlton"
    },
    {
        quote: "Walking on water and developing software from a specification are easy if both are frozen.",
        author: "Edward V. Berard"
    },
    {
        quote: "The trouble with programmers is that you can never tell what a programmer is doing until it's too late.",
        author: "Seymour Cray"
    },
    {
        quote: "Programming is like writing a book... except if you miss out a single comma on page 126, the whole thing makes no sense.",
        author: "Anonymous"
    },
    {
        quote: "A good programmer is someone who always looks both ways before crossing a one-way street.",
        author: "Doug Linder"
    },
    {
        quote: "Experience is the name everyone gives to their mistakes.",
        author: "Oscar Wilde"
    },
    {
        quote: "In order to understand recursion, one must first understand recursion.",
        author: "Anonymous"
    },
    {
        quote: "Java is to JavaScript what car is to Carpet.",
        author: "Chris Heilmann"
    },
    {
        quote: "There are two ways to write error-free programs; only the third one works.",
        author: "Alan J. Perlis"
    },
    {
        quote: "Programming today is a race between software engineers striving to build bigger and better idiot-proof programs, and the Universe trying to produce bigger and better idiots.",
        author: "Rick Cook"
    }
];

// Moods and energy levels
const moods = ["💪 Determined", "🔥 Motivated", "⚡ Energetic", "🚀 Ready", "✨ Inspired", "🎯 Focused", "😎 Confident", "🧠 Thoughtful", "💡 Creative", "🌟 Ambitious"];
const energyLevels = ["☕☕☕☕ High", "☕☕☕☕☕ Maximum", "☕☕☕ Good", "☕☕☕☕⚡ Supercharged", "☕☕ Moderate", "☕☕☕☕☕⚡ Ultra High"];
const goals = [
    "Build something amazing today!",
    "Turn ideas into reality!",
    "Code the future!",
    "Create something beautiful!",
    "Solve problems with code!",
    "Make an impact through technology!",
    "Debug the world, one line at a time!",
    "Transform coffee into code!",
    "Build bridges with technology!",
    "Innovate and inspire others!",
    "Write code that changes lives!",
    "Push the boundaries of possibility!"
];
const statuses = ["🚀 Ready to code!", "💻 In the zone!", "🔥 On fire!", "⚡ Supercharged!", "✨ Feeling creative!", "🎯 Laser focused!", "🧙‍♂️ Code wizard mode!", "🎨 Crafting digital art!", "🔧 Building the future!", "💫 Making magic happen!"];

function getCurrentDateTime() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toISOString().split('T')[1].split('.')[0] + ' UTC';
    
    // Also get IST time for logging
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const istString = istTime.toISOString().split('T')[1].split('.')[0] + ' IST';
    
    return { date, time, istTime: istString };
}

function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function updateReadme() {
    const readmePath = path.join(__dirname, '../../README.md');
    
    if (!fs.existsSync(readmePath)) {
        console.error('❌ README.md not found at:', readmePath);
        process.exit(1);
    }
    
    let content = fs.readFileSync(readmePath, 'utf8');
    
    const { date, time, istTime } = getCurrentDateTime();
    const selectedQuote = getRandomElement(quotes);
    const selectedMood = getRandomElement(moods);
    const selectedEnergy = getRandomElement(energyLevels);
    const selectedGoal = getRandomElement(goals);
    const selectedStatus = getRandomElement(statuses);
    
    // Update the motivation section with more flexible regex
    const motivationRegex = /```javascript[\s\S]*?\/\/ Today's Motivation - Updated:[\s\S]*?```/;
    
    const newMotivation = `\`\`\`javascript
// Today's Motivation - Updated: ${date} ${time}
const motivation = {
    date: "${date}",
    time: "${time}",
    quote: "${selectedQuote.quote.replace(/"/g, '\\"')}",
    author: "${selectedQuote.author}",
    mood: "${selectedMood}",
    energy: "${selectedEnergy}",
    goal: "${selectedGoal}",
    status: "${selectedStatus}"
};

console.log(\`"\${motivation.quote} - \${motivation.author}"\`);
// Output: "${selectedQuote.quote.replace(/"/g, '\\"')} - ${selectedQuote.author}"
\`\`\``;
    
    if (motivationRegex.test(content)) {
        content = content.replace(motivationRegex, newMotivation);
        console.log('✅ Motivation section updated');
    } else {
        console.log('⚠️ Motivation section not found - regex may need adjustment');
    }
    
    // Update the learning journey last_updated field (handle both normal quotes and HTML entities)
    const learningRegex = /last_updated: (?:"[^"]+"|&quot;[^&]*&quot;)/;
    if (learningRegex.test(content)) {
        content = content.replace(learningRegex, `last_updated: "${date} ${time}"`);
        console.log('✅ Learning journey timestamp updated');
    } else {
        console.log('⚠️ Learning journey section not found - checking for HTML entities');
        // Try to find and fix HTML entities in the entire learning section
        const yamlSectionRegex = /(```yaml[\s\S]*?```)/;
        if (yamlSectionRegex.test(content)) {
            content = content.replace(yamlSectionRegex, (match) => {
                // Decode HTML entities and update timestamp
                let decodedMatch = match
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>');
                
                // Update the timestamp
                decodedMatch = decodedMatch.replace(/last_updated: "[^"]+"/, `last_updated: "${date} ${time}"`);
                
                return decodedMatch;
            });
            console.log('✅ Learning journey section decoded and timestamp updated');
        }
    }
    
    // Update the footer timestamp with more flexible regex
    const footerRegex = /<img src="https:\/\/img\.shields\.io\/badge\/Last_Updated-[^"]+" alt="Last Updated"\/?>/;
    const newFooterTimestamp = `<img src="https://img.shields.io/badge/Last_Updated-${date.replace(/-/g, '--')}_${time.replace(/:/g, '%3A').replace(/ /g, '_')}-blue?style=flat&logo=clock" alt="Last Updated"/>`;
    
    if (footerRegex.test(content)) {
        content = content.replace(footerRegex, newFooterTimestamp);
        console.log('✅ Footer timestamp updated');
    }
    
    // Write the updated content back to the file
    fs.writeFileSync(readmePath, content, 'utf8');
    
    console.log('\n🎉 README.md updated successfully!');
    console.log(`📅 Date: ${date}`);
    console.log(`⏰ UTC Time: ${time}`);
    console.log(`🇮🇳 IST Time: ${istTime}`);
    console.log(`💭 Quote: "${selectedQuote.quote}" - ${selectedQuote.author}`);
    console.log(`😄 Mood: ${selectedMood}`);
    console.log(`⚡ Energy: ${selectedEnergy}`);
    console.log(`🎯 Goal: ${selectedGoal}`);
    console.log(`🚀 Status: ${selectedStatus}`);
}

// Run the update
updateReadme();