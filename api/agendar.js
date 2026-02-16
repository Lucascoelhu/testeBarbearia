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

  // CORREÇÃO 1: Sintaxe JavaScript correta
  const projectId = "barbeariatestes"; // ← Removido o ":"
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  try {
    const ag = req.body;
    console.log("Payload:", JSON.stringify(ag));

    // Validação reforçada
    if (!ag.cliente || ag.cliente.trim().length < 2) {
      return res.status(400).json({ erro: 'Nome do cliente inválido' });
    }
    if (!ag.data || !ag.hora || !ag.barbeiroId) {
      return res.status(400).json({ erro: 'Dados incompletos' });
    }

    const duracao = parseInt(ag.duracao) || 30;
    const slotsNecessarios = Math.ceil(duracao / 10);

    // 🔴 PASSO 1: BUSCAR AGENDAMENTOS EXISTENTES
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
      headers: { 
        'Content-Type': 'application/json'
        // NOTA: Para produção, você deve usar autenticação do Google Cloud
      },
      body: JSON.stringify(queryBody)
    });

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      console.error("Erro Firestore:", errorText);
      throw new Error(`Erro na query: ${errorText}`);
    }

    const agendamentosExistentes = await queryResponse.json();

    // 🔴 PASSO 2: VERIFICAR CONFLITOS
    const ocupados = new Set();

    agendamentosExistentes.forEach(doc => {
      if (!doc.document) return;
      
      const fields = doc.document.fields || {};
      const horaExistente = fields.hora?.stringValue;
      const duracaoExistente = parseInt(fields.duracao?.integerValue) || 30;
      
      if (horaExistente) {
        const slots = Math.ceil(duracaoExistente / 10);
        let tempHora = horaExistente;
        
        for (let i = 0; i < slots; i++) {
          ocupados.add(tempHora);
          tempHora = somar10Minutos(tempHora);
        }
      }
    });

    // Verifica conflito
    let horaChecar = ag.hora;
    for (let i = 0; i < slotsNecessarios; i++) {
      if (ocupados.has(horaChecar)) {
        return res.status(409).json({ 
          erro: 'CONFLITO_HORARIO',
          mensagem: `O horário ${ag.hora} já foi reservado. Escolha outro horário.`
        });
      }
      horaChecar = somar10Minutos(horaChecar);
    }

    // 🔴 PASSO 3: SALVAR NO FIRESTORE
    const documentData = {
      fields: {
        cliente: { stringValue: ag.cliente.toUpperCase().trim() },
        whatsapp: { stringValue: (ag.whatsapp || '').replace(/\D/g, '') }, // Limpa formatação
        barbeiroId: { stringValue: ag.barbeiroId },
        barbeiroNome: { stringValue: (ag.barbeiroNome || 'Não informado').toUpperCase() },
        data: { stringValue: ag.data },
        hora: { stringValue: ag.hora },
        servico: { stringValue: (ag.servico || '').toUpperCase().trim() },
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

    // 4. NOTIFICAÇÃO TELEGRAM (CORREÇÃO DO ESPAÇO NA URL)
    try {
      const botUrl = `${baseUrl}/configuracao/bot`;
      const botResponse = await fetch(botUrl);
      
      if (botResponse.ok) {
        const botData = await botResponse.json();
        const fields = botData.fields || {};
        
        const token = fields.token?.stringValue;
        const chatid = fields.chatid?.stringValue;

        if (token && chatid) {
          const dataFormatada = ag.data.split('-').reverse().join('/');
          
          const msg = `✂️ <b>NOVO AGENDAMENTO</b>\n\n` +
                      `👤 <b>Cliente:</b> ${ag.cliente.toUpperCase()}\n` +
                      `📅 <b>Data:</b> ${dataFormatada}\n` +
                      `⏰ <b>Hora:</b> ${ag.hora}\n` +
                      `🧔 <b>Barbeiro:</b> ${ag.barbeiroNome || 'Não informado'}\n` +
                      `⚡ <b>Serviço:</b> ${(ag.servico || '').toUpperCase()}`;

          // CORREÇÃO: URL sem espaço
          const telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              chat_id: chatid, 
              text: msg, 
              parse_mode: 'HTML' 
            })
          });

          if (!telegramRes.ok) {
            console.error("Erro Telegram:", await telegramRes.text());
          }
        }
      }
    } catch (telegramErr) {
      console.error("Erro Telegram (não crítico):", telegramErr.message);
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
