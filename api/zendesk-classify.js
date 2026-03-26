// Vercel serverless function: fetches Zendesk tickets and classifies them with Claude AI
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subdomain, email, apiToken, claudeApiKey, maxTickets = 50 } = req.body || {};

  if (!subdomain || !email || !apiToken || !claudeApiKey) {
    return res.status(400).json({ error: 'Missing required fields: subdomain, email, apiToken, claudeApiKey' });
  }

  const auth = Buffer.from(`${email}/token:${apiToken}`).toString('base64');
  const zdBase = `https://${subdomain}.zendesk.com/api/v2`;

  // Fetch tickets
  let tickets = [];
  try {
    const r = await fetch(
      `${zdBase}/tickets.json?per_page=${Math.min(maxTickets, 100)}&sort_by=created_at&sort_order=desc`,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } }
    );
    if (!r.ok) {
      const text = await r.text();
      return res.status(400).json({ error: `Zendesk error (${r.status}): ${text}` });
    }
    const data = await r.json();
    tickets = data.tickets || [];
  } catch (e) {
    return res.status(500).json({ error: `Failed to reach Zendesk: ${e.message}` });
  }

  if (tickets.length === 0) {
    return res.status(200).json({ tickets: [] });
  }

  // Fetch comments for each ticket (parallel, max 10 at a time)
  const fetchComments = async (ticket) => {
    try {
      const r = await fetch(`${zdBase}/tickets/${ticket.id}/comments.json`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return { ...ticket, customer_message: ticket.description || '', agent_response: '' };
      const data = await r.json();
      const comments = data.comments || [];
      // First comment is usually from requester; find first public agent reply
      const customerMsg = comments[0]?.body || ticket.description || '';
      const agentReply = comments.find((c) => c.author_id !== ticket.requester_id && c.public);
      return {
        id: ticket.id,
        subject: ticket.subject || '',
        status: ticket.status || '',
        created_at: ticket.created_at || '',
        requester_id: ticket.requester_id,
        customer_message: customerMsg.slice(0, 800),
        agent_response: (agentReply?.body || '').slice(0, 800),
      };
    } catch {
      return {
        id: ticket.id,
        subject: ticket.subject || '',
        status: ticket.status || '',
        created_at: ticket.created_at || '',
        customer_message: ticket.description || '',
        agent_response: '',
      };
    }
  };

  // Fetch in batches of 10
  const enriched = [];
  for (let i = 0; i < tickets.length; i += 10) {
    const batch = await Promise.all(tickets.slice(i, i + 10).map(fetchComments));
    enriched.push(...batch);
  }

  // Classify with Claude in batches of 20 tickets
  const BATCH_SIZE = 20;
  const allClassifications = [];

  for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
    const batch = enriched.slice(i, i + BATCH_SIZE);
    const prompt = `Classify the following customer support tickets. For each ticket return a JSON object with:
- "category": main inquiry type (e.g. "בעיה טכנית", "חיוב ותשלום", "החזר כספי", "בקשת תכונה", "גישה לחשבון", "מידע על מוצר", "תלונה", "מחמאה", "בעיית משלוח", "אחר")
- "sub_category": specific sub-topic in 2-4 words
- "sentiment": customer sentiment ("חיובי", "ניטרלי", "שלילי", "מתוסכל", "מרוצה")
- "response_quality": agent response quality ("מצוין", "טוב", "מספיק", "דורש שיפור", "אין תגובה")
- "summary": 1-2 sentence summary of inquiry and resolution (use Hebrew if ticket is in Hebrew, English otherwise)

Return ONLY a valid JSON array with exactly ${batch.length} objects in the same order as the input. No markdown, no explanation.

Tickets:
${JSON.stringify(batch.map((t) => ({
  subject: t.subject,
  customer_message: t.customer_message,
  agent_response: t.agent_response,
})))}`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        // Fallback: unknown classification for this batch
        allClassifications.push(...batch.map(() => ({
          category: 'אחר', sub_category: '', sentiment: 'ניטרלי',
          response_quality: 'לא ידוע', summary: data.error?.message || 'Classification failed',
        })));
        continue;
      }
      const text = (data.content?.[0]?.text || '').trim();
      // Strip markdown code fences if present
      const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = JSON.parse(clean);
      allClassifications.push(...parsed);
    } catch (e) {
      allClassifications.push(...batch.map(() => ({
        category: 'אחר', sub_category: '', sentiment: 'ניטרלי',
        response_quality: 'לא ידוע', summary: `Classification error: ${e.message}`,
      })));
    }
  }

  const result = enriched.map((ticket, i) => ({
    ...ticket,
    ...(allClassifications[i] || { category: 'אחר', sub_category: '', sentiment: 'ניטרלי', response_quality: 'לא ידוע', summary: '' }),
  }));

  return res.status(200).json({ tickets: result, total: result.length });
}
