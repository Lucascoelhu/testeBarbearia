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

    const projectId: "barbeariatestes";
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    try {
        const ag = req.body;
        console.log("Payload:", JSON.stringify(ag));

        // Validação
        if (!ag.cliente || !ag.data || !ag.hora || !ag.barbeiroId) {
            return res.status(400).json({ erro: 'Dados incompletos' });
        }

        const duracao = parseInt(ag.duracao) || 30;
        const slotsNecessarios = Math.ceil(duracao / 10);

        // 🔴 PASSO 1: BUSCAR TODOS OS AGENDAMENTOS EXISTENTES DESTE DIA/BARBEIRO
        // Usando query estruturada do Firestore REST API
        const queryUrl = `${baseUrl}:runQuery`;
        
        const queryBody = {
            structuredQuery: {
                from: [{ collectionId: "agenda" }],
                where: {
                    compositeFilter: {
                        op: "AND",
                        filters: [
                            {
                                fieldFilter: {
                                    field: { fieldPath: "data" },
                                    op: "EQUAL",
                                    value: { stringValue: ag.data }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: "barbeiroId" },
                                    op: "EQUAL",
                                    value: { stringValue: ag.barbeiroId }
                                }
                            }
                        ]
                    }
                }
            }
        };

        const queryResponse = await fetch(queryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(queryBody)
        });

        if (!queryResponse.ok) {
            const errorText = await queryResponse.text();
            throw new Error(`Erro na query: ${errorText}`);
        }

        const agendamentosExistentes = await queryResponse.json();
        console.log(`📊 Encontrados ${agendamentosExistentes.length} agendamentos para ${ag.data}`);

        // 🔴 PASSO 2: VERIFICAR CONFLITOS DE HORÁRIO
        // Monta um Set com todos os slots ocupados (expandindo a duração de cada um)
        const ocupados = new Set();

        agendamentosExistentes.forEach(doc => {
            if (!doc.document) return; // Pode vir vazio se não encontrar nada
            
            const fields = doc.document.fields || {};
            const horaExistente = fields.hora?.stringValue;
            const duracaoExistente = parseInt(fields.duracao?.integerValue) || 30;
            
            if (horaExistente) {
                // Expande todos os slots que este agendamento ocupa
                const slots = Math.ceil(duracaoExistente / 10);
                let tempHora = horaExistente;
                
                for (let i = 0; i < slots; i++) {
                    ocupados.add(tempHora);
                    tempHora = somar10Minutos(tempHora);
                }
            }
        });

        // Verifica se o novo agendamento conflita
        let horaChecar = ag.hora;
        for (let i = 0; i < slotsNecessarios; i++) {
            if (ocupados.has(horaChecar)) {
                console.log(`❌ CONFLITO DETECTADO: Horário ${horaChecar} já ocupado`);
                return res.status(409).json({ 
                    erro: 'CONFLITO_HORARIO',
                    mensagem: `O horário ${ag.hora} ou seus slots subsequentes acabaram de ser reservados por outro cliente. Por favor, escolha outro horário.`
                });
            }
            horaChecar = somar10Minutos(horaChecar);
        }

        console.log("✅ Sem conflitos, prosseguindo com o agendamento...");

        // 🔴 PASSO 3: SALVAR NO FIRESTORE (só chega aqui se não houver conflito)
        const documentData = {
            fields: {
                cliente: { stringValue: ag.cliente.toUpperCase() },
                whatsapp: { stringValue: ag.whatsapp || '' },
                barbeiroId: { stringValue: ag.barbeiroId },
                barbeiroNome: { stringValue: ag.barbeiroNome || 'Não informado' },
                data: { stringValue: ag.data },
                hora: { stringValue: ag.hora },
                servico: { stringValue: (ag.servico || '').toUpperCase() },
                duracao: { integerValue: duracao },
                criadoEm: { timestampValue: new Date().toISOString() },
                status: { stringValue: 'confirmado' }
            }
        };

        const firestoreUrl = `${baseUrl}/agenda`;
        
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

        // 4. ENVIA NOTIFICAÇÃO TELEGRAM (mantido igual)
        try {
            const botUrl = `${baseUrl}/configuracao/bot`;
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
                }
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

// Helper para somar 10 minutos a um horário "HH:MM"
function somar10Minutos(hora) {
    const [h, m] = hora.split(':').map(Number);
    let novosMinutos = m + 10;
    let novasHoras = h;
    
    if (novosMinutos >= 60) {
        novasHoras++;
        novosMinutos = 0;
    }
    
    return `${String(novasHoras).padStart(2, '0')}:${String(novosMinutos).padStart(2, '0')}`;
}
