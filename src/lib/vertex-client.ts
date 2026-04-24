export class GoogleGenAI {
  models: {
    generateContent: (req: any) => Promise<any>
  };

  constructor(opts?: any) {
    this.models = {
      generateContent: async (req: any) => {
  const apiBase = ((import.meta as any).env?.VITE_API_BASE_URL as string) || '/api';
        const response = await fetch(`${apiBase.replace(/\/$/, '')}/vertex/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed API call");
        }
        
        const data = await response.json();
        
        // Ensure compatibility with the GenerateContentResponse shape
        return {
          ...data,
          get text() {
            return data.text;
          }
        };
      }
    };
  }
}
