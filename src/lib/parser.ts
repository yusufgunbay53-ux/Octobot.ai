export function parseAgentAction(text: string): {thought: string, action: string, params: any, isTaskComplete?: boolean} {
  try {
    let cleanText = text.trim();
    
    // Find the first { and last } to extract JSON when there's prefix or suffix text
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
    
    const parsed = JSON.parse(cleanText);
    
    return {
      thought: parsed.thought || "",
      action: parsed.action || "FINISH",
      params: parsed.params || {},
      isTaskComplete: !!parsed.isTaskComplete
    };
  } catch (error) {
    console.error("Failed to parse agent action", text, error);
    return { thought: "Error parsing format", action: "FINISH", params: {}, isTaskComplete: true };
  }
}

