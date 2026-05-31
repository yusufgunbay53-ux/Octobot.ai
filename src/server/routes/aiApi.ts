import { Router } from 'express';
import { parseAgentAction } from '../../lib/parser';

const router = Router();
const MISTRAL_API_KEY = "HZ5HpRrF9umDeodp5h1fc8FzbdTAzYOq";
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

const systemInstruction = `Sen bir yapay zeka tarayıcı otomasyon motorusun. Kullanıcının verdiği hedefi gerçekleştirmek için web sayfasında adımlar atacaksın.
Kullanıcı sana her adımda sayfanın mevcut durumunu (sadeleştirilmiş HTML ve data-agent-id etiketli elementleri) verecek.

Senin görevin durumu analiz etmek ve YAPMAN GEREKEN BİR SONRAKİ ADIMI kesinlikle aşağıdaki JSON formatında vermek. 

JSON Formatı:
{
  "thought": "Şu an sayfadayım, arama kutusunu gördüm, oraya tıklayıp veri yazacağım.",
  "action": "TYPE" | "CLICK" | "SCROLL" | "NAVIGATE" | "FINISH",
  "params": { 
    "agentId": "el_1 (Eğer TYPE veya CLICK ise gerekli. SADECE var olan idleri kullan, UYDURMA)", 
    "text": "Araba (TYPE ise gerekli)", 
    "url": "https://... (NAVIGATE ise gerekli)",
    "direction": "down veya up (SCROLL ise gerekli)"
  },
  "isTaskComplete": false
}

Kurallar:
- Eğer kullanıcı bir web sitesine gitmeni, bir sayfa açmanı veya arama yapmanı isterse (örneğin 'google.com'a git', 'youtube aç') İLK İŞ OLARAK "action": "NAVIGATE" kullan ve "params.url" kısmına hedef URL'yi (http/https dahil, örn: "https://www.google.com") yaz.
- BAŞKA ADIM GEREKMİYORSA "isTaskComplete": true OLARAK AYARLA. (Örneğin sadece tıklama, sayfaya gitme veya veri girme emri verildiyse ve bunu GEÇMİŞ İŞLEMLER'de yaptıysan true yap ki görev sonlansın). Yeni açılan sayfalarda işlemi tekrarlama.
- Kullanıcı tek bir buton tıklaması istediyse, GEÇMİŞ İŞLEMLER'de tıklandıysa GÖREV BİTMİŞTİR. Yeni öğreler arama.
- Eğer EKRAN DURUMLARI NEDENİYLE ilerlenemiyorsa "action": "FINISH" döndür.
- SADECE geçerli bir JSON döndür. Markdown JSON blokları (\`\`\`json ... \`\`\`) kullanabilirsin.`;

router.post('/decide', async (req, res) => {
  try {
    const { prompt, htmlState } = req.body;
    
    let response;
    let retries = 3;
    let delay = 15000; // 15 seconds
    let lastErrorText = "";
    let statusCode = 500;
    let currentModel = "mistral-large-latest";
    
    // Try multiple times in case of rate limit (429)
    for (let i = 0; i < retries; i++) {
      response = await fetch(MISTRAL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `Mevcut Ekran Durumu (HTML DOM):\n${htmlState}\n\nKullanıcı Ana Hedefi: ${prompt}\n\nMevcut durumu analiz et ve hedefe ulaşmak için atman gereken BİR SONRAKİ TEK ADIMI JSON olarak döndür.` }
          ],
          max_tokens: 500,
          temperature: 0.1,
        })
      });

      if (response.ok) {
        break; // Success!
      }

      statusCode = response.status;
      lastErrorText = await response.text();
      
      // If rate limited, wait and try again
      if (response.status === 429) {
        console.warn(`Mistral rate limited on ${currentModel}. Retrying in ${delay}ms...`);
        // Switch to a smaller model on subsequent retries for better rate limits
        if (i === 0) {
           currentModel = "mistral-small-latest";
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        // keep delay at 15000
      } else {
        // Break on other errors (e.g. 401, 400)
        break;
      }
    }

    if (!response || !response.ok) {
      throw new Error(`Mistral API Error: ${statusCode} - ${lastErrorText}`);
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || "";
    const parsed = parseAgentAction(aiText);
    res.json({ success: true, ...parsed });

  } catch (error: any) {
    console.error("AI Proxy Error:", error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

export default router;
