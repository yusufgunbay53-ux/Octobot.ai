export async function decideNextAction(prompt: string, htmlState: string): Promise<{thought: string, action: string, params: any, isTaskComplete?: boolean}> {
  try {
    const response = await fetch('/api/ai/decide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt, htmlState })
    });

    if (!response.ok) {
       const text = await response.text();
       throw new Error(`Server Error: ${response.status} ${text}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error);
    }
    
    return {
      thought: data.thought,
      action: data.action,
      params: data.params,
      isTaskComplete: data.isTaskComplete
    };
  } catch (error) {
    console.error("AI Error:", error);
    throw error;
  }
}
