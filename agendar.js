export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    const projectId = "elnes-720ce";

    try {
        const ag = req.body;
        console.log("Payload:", JSON.stringify(ag));

        // Validação
        if (!ag.cliente || !ag.data || !ag.hora || !ag.barbeiroId) {
            return res.status(400).json({ erro: 'Dados incompletos' });
        }

        // 1. SALVA NO FIRESTORE
        const documentData = {
            fields: {
                cliente: { stringValue: ag.cliente.toUpperCase() },
                whatsapp: { stringValue: ag.whatsapp || '' },
                barbeiroId: { stringValue: ag.barbeiroId },
                barbeiroNome: { stringValue: ag.barbeiroNome || 'Não informado' },
                data: { stringValue: ag.data },
                hora: { stringValue: ag.hora },
                servico: { stringValue: (ag.servico || '').toUpperCase() },
                duracao: { integerValue: parseInt(ag.duracao) || 30 },
                criadoEm: { timestampValue: new Date().toISOString() },
                status: { stringValue: 'confirmado' }
            }
        };

        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/agenda`;
        
        const response = await fetch(firestoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(documentData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore: ${errorText}`);
        }

        const result = await response.json();
        const docId = result.name.split('/').pop();
        console.log("✅ Documento criado:", docId);

        // 2. BUSCA CONFIG DO BOT E ENVIA NOTIFICAÇÃO
        try {
            const botUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/configuracao/bot`;
            const botResponse = await fetch(botUrl);
            
            if (botResponse.ok) {
                const botData = await botResponse.json();
                const fields = botData.fields || {};
                
                const token = fields.token?.stringValue;
                const chatid = fields.chatid?.stringValue;
                
                console.log("Bot config:", { token: token ? "OK" : "Faltando", chatid: chatid ? "OK" : "Faltando" });

                if (token && chatid) {
                    const dataFormatada = ag.data.split('-').reverse().join('/');
                    
                    const msg = `✂️ <b>NOVO AGENDAMENTO</b>\n\n` +
                                `👤 <b>Cliente:</b> ${ag.cliente.toUpperCase()}\n` +
                                `📅 <b>Data:</b> ${dataFormatada}\n` +
                                `⏰ <b>Hora:</b> ${ag.hora}\n` +
                                `🧔 <b>Barbeiro:</b> ${ag.barbeiroNome || 'Não informado'}\n` +
                                `⚡ <b>Serviço:</b> ${(ag.servico || '').toUpperCase()}`;

                    const telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            chat_id: chatid, 
                            text: msg, 
                            parse_mode: 'HTML' 
                        })
                    });

                    if (telegramRes.ok) {
                        console.log("✅ Telegram enviado");
                    } else {
                        const teleErro = await telegramRes.text();
                        console.error("❌ Telegram erro:", teleErro);
                    }
                } else {
                    console.log("⚠️ Token ou chatid não configurados no Firestore");
                }
            } else {
                console.log("⚠️ Documento 'configuracao/bot' não encontrado no Firestore");
            }
        } catch (telegramErr) {
            console.error("⚠️ Erro Telegram (não crítico):", telegramErr.message);
        }

        return res.status(200).json({ 
            sucesso: true,
            id: docId,
            mensagem: 'Agendamento realizado com sucesso'
        });

    } catch (error) {
        console.error("❌ ERRO:", error);
        return res.status(500).json({ 
            erro: 'Erro interno',
            mensagem: error.message
        });
    }
}
