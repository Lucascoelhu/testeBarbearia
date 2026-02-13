// api/agendar.js
export default async function handler(req, res) {
    // A Vercel injeta automaticamente as variáveis que você cadastrou no painel
    const URL_BANCO = process.env.BANCO_URL;
    const CHAVE_BANCO = process.env.BANCO_KEY;

    if (req.method === 'POST') {
        const dados = req.body;

        try {
            // AQUI você coloca a lógica que hoje está no seu HTML/JS
            // Exemplo genérico:
            // await seuBanco.insert(dados); 
            
            return res.status(200).json({ mensagem: "Agendado com sucesso!" });
        } catch (error) {
            return res.status(500).json({ erro: error.message });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Método ${req.method} não permitido`);
    }
}