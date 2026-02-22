require('dotenv').config();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function test() {
    console.log("Using key:", GEMINI_API_KEY.substring(0, 10) + '...');
    const fetch = (await import('node-fetch')).default;
    const prompt = '{"signal": "BUY", "confidence": 75, "reasoning": "RSI is low"}';

    try {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Hello, reply with " + prompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 500,
                        responseMimeType: 'application/json'
                    }
                }),
                timeout: 15000
            }
        );
        const geminiData = await geminiRes.text();
        console.log("Response:", geminiData);
    } catch (e) {
        console.log("Error:", e);
    }
}
test();
