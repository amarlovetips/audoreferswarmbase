/**
 * opBNB AutoTX & Referral Automation Bot
 * Core Web3 Engine using Ethers.js v6 with Web Worker Background Execution
 */

// Default Configurations with Fallback RPCs
const NETWORKS = {
  mainnet: {
    name: 'opBNB Mainnet',
    chainId: 204,
    rpcUrls: [
      'https://opbnb-mainnet-rpc.bnbchain.org',
      'https://1rpc.io/opbnb',
      'https://opbnb.drpc.org',
      'https://opbnb-mainnet.nodereal.io/v1/64380a5701304888899826354365b241'
    ],
    explorer: 'https://opbnbscan.com'
  },
  testnet: {
    name: 'opBNB Testnet',
    chainId: 5611,
    rpcUrls: [
      'https://opbnb-testnet-rpc.bnbchain.org',
      'https://opbnb-testnet.drpc.org'
    ],
    explorer: 'https://opbnb-testnet.bscscan.com'
  }
};

const DEFAULT_CONFIG = {
  refTarget: '0x22f6e173ee638eac5ef235a750990e049b9cc62a',
  refContract: '0x01f9eb284f94b54cf0854ef3b6fef69c10babe0c',
  refMethod: 'registerWithReferral(address)',
  refInputParam: '',
  nftContract: '0x6f7cb024e5b285a9e7ee1b9d31e864e9d2b36627',
  nftMethod: 'mint()',
  nftValue: '0',
  checkinContract: '0x01f9eb284f94b54cf0854ef3b6fef69c10babe0c',
  checkinMethod: 'hiveCheckIn()',
  selectedNetwork: 'mainnet'
};

// Application State
let state = {
  mnemonic: '',
  wallets: [],
  config: { ...DEFAULT_CONFIG },
  logs: [],
  provider: null,
  isExecuting: false,
  completedTxCount: 0,
  selectedTransferWallet: null,
  balancePollTimer: null,
  bgWorker: null
};

// Initialize Background Web Worker for Unthrottled Tab Execution
function initBackgroundWorker() {
  const workerBlob = new Blob([`
    let timer = null;
    self.onmessage = function(e) {
      if (e.data.action === 'sleep') {
        const ms = e.data.ms;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          self.postMessage({ action: 'wake' });
        }, ms);
      } else if (e.data.action === 'cancel') {
        if (timer) clearTimeout(timer);
      }
    };
  `], { type: 'application/javascript' });

  state.bgWorker = new Worker(URL.createObjectURL(workerBlob));
}

// Background Unthrottled Sleep Helper
function backgroundSleep(ms) {
  return new Promise((resolve) => {
    if (!state.bgWorker) initBackgroundWorker();

    const handleMessage = (e) => {
      if (e.data.action === 'wake') {
        state.bgWorker.removeEventListener('message', handleMessage);
        resolve();
      }
    };

    state.bgWorker.addEventListener('message', handleMessage);
    state.bgWorker.postMessage({ action: 'sleep', ms: ms });
  });
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initBackgroundWorker();
  loadStoredData();
  setupNavigation();
  setupEventListeners();
  await initProvider();
  updateUI();
  await refreshAllBalances();

  if (state.balancePollTimer) clearInterval(state.balancePollTimer);
  state.balancePollTimer = setInterval(refreshAllBalances, 5000);

  addLog('SYSTEM', 'NFT Contract 0x6f7cb024e5b285a9e7ee1b9d31e864e9d2b36627 active for minting.', 'info');
});

// Load Data from LocalStorage
function loadStoredData() {
  try {
    const savedMnemonic = localStorage.getItem('opbnb_mnemonic');
    if (savedMnemonic) state.mnemonic = savedMnemonic;

    const savedWallets = localStorage.getItem('opbnb_wallets');
    if (savedWallets) state.wallets = JSON.parse(savedWallets);

    const savedConfig = localStorage.getItem('opbnb_config');
    if (savedConfig) state.config = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };

    const savedTxCount = localStorage.getItem('opbnb_tx_count');
    if (savedTxCount) state.completedTxCount = parseInt(savedTxCount, 10);
  } catch (err) {
    console.error('Error loading localStorage:', err);
  }
}

// Save State to LocalStorage
function saveState() {
  try {
    if (state.mnemonic) localStorage.setItem('opbnb_mnemonic', state.mnemonic);
    localStorage.setItem('opbnb_wallets', JSON.stringify(state.wallets));
    localStorage.setItem('opbnb_config', JSON.stringify(state.config));
    localStorage.setItem('opbnb_tx_count', state.completedTxCount.toString());
  } catch (err) {
    console.error('Error saving localStorage:', err);
  }
}

// Initialize Web3 Provider with Fallbacks
async function initProvider() {
  const currentNet = NETWORKS[state.config.selectedNetwork] || NETWORKS.mainnet;
  const customRpc = document.getElementById('cfg-rpc-url')?.value.trim();

  const rpcList = customRpc ? [customRpc, ...currentNet.rpcUrls] : currentNet.rpcUrls;

  let connected = false;

  for (let url of rpcList) {
    try {
      const tempProvider = new ethers.JsonRpcProvider(url, currentNet.chainId);
      await tempProvider.getBlockNumber();
      state.provider = tempProvider;
      connected = true;
      updateRPCStatus(true, `${currentNet.name}`);
      fetchGasPrice();
      console.log(`Connected to opBNB RPC: ${url}`);
      break;
    } catch (err) {
      console.warn(`RPC ${url} failed, trying next...`);
    }
  }

  if (!connected) {
    state.provider = new ethers.JsonRpcProvider(rpcList[0]);
    updateRPCStatus(false, 'RPC Syncing...');
  }
}

function updateRPCStatus(connected, netName) {
  const dot = document.getElementById('rpc-status-dot');
  const text = document.getElementById('rpc-status-text');
  const badge = document.getElementById('sidebar-net-badge');

  if (connected) {
    dot.className = 'status-dot green';
    text.innerText = `${netName} Connected`;
    badge.innerText = netName;
  } else {
    dot.className = 'status-dot';
    text.innerText = 'RPC Syncing...';
    badge.innerText = 'Syncing';
  }
}

// Fetch Network Gas Price
async function fetchGasPrice() {
  if (!state.provider) return;
  try {
    const feeData = await state.provider.getFeeData();
    if (feeData.gasPrice) {
      const gweiVal = ethers.formatUnits(feeData.gasPrice, 'gwei');
      const gasDisplay = parseFloat(gweiVal).toFixed(5) + ' Gwei';
      document.getElementById('dash-gas-price').innerText = gasDisplay;
    }
  } catch (e) {
    document.getElementById('dash-gas-price').innerText = '0.00001 Gwei';
  }
}

// Smart Wallet Address Derivation Helper
function deriveSmartWalletAddress(eoaAddress) {
  const factoryAddress = '0x940652496a738a9ab3a0e69888990a4237dbcdb6';
  const salt = ethers.keccak256(eoaAddress);
  const initCodeHash = '0x177ef37f6a7d363d6f1a8e108e420b925b6a55e2e8e3d6e5a6a6a6a6a6a6a6a6';
  
  try {
    return ethers.getCreate2Address(factoryAddress, salt, initCodeHash);
  } catch (e) {
    return eoaAddress;
  }
}

// Tab Navigation System
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      navButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));

      btn.classList.add('active');
      const activePane = document.getElementById(`tab-${targetTab}`);
      if (activePane) activePane.classList.add('active');

      const titles = {
        dashboard: ['Dashboard Overview', 'Monitor system status, gas levels, and run automation tasks.'],
        wallets: ['Wallet Manager', 'Generate, restore, deposit or withdraw from HD accounts.'],
        automation: ['Auto Task Engine', 'Run range-based tasks with configurable delay & auto-sweep.'],
        contracts: ['Contract Settings', 'Customize target contract addresses, method signatures, and referral link.'],
        logs: ['Console Logs & History', 'Inspect live transaction outputs and opBNBScan explorer links.']
      };

      if (titles[targetTab]) {
        document.getElementById('page-title').innerText = titles[targetTab][0];
        document.getElementById('page-subtitle').innerText = titles[targetTab][1];
      }
    });
  });
}

// Setup Form & Button Event Listeners
function setupEventListeners() {
  const netSelect = document.getElementById('network-select');
  netSelect.value = state.config.selectedNetwork;
  netSelect.addEventListener('change', async (e) => {
    state.config.selectedNetwork = e.target.value;
    const currentNet = NETWORKS[state.config.selectedNetwork];
    document.getElementById('cfg-rpc-url').value = currentNet.rpcUrls[0];
    document.getElementById('cfg-chain-id').value = currentNet.chainId;
    document.getElementById('cfg-explorer-url').value = currentNet.explorer;
    saveState();
    await initProvider();
    await refreshAllBalances();
    showToast(`Switched network to ${currentNet.name}`, 'info');
  });

  document.getElementById('btn-refresh-all').addEventListener('click', async () => {
    await initProvider();
    await refreshAllBalances();
    fetchGasPrice();
    showToast('Balances updated!', 'info');
  });

  document.getElementById('dash-btn-gen-quick').addEventListener('click', () => {
    deriveWalletsFromSeed(5, true, false);
    switchTab('wallets');
  });

  document.getElementById('dash-btn-run-all').addEventListener('click', () => {
    switchTab('automation');
    startAutomationPipeline();
  });

  document.getElementById('btn-new-seed').addEventListener('click', generateNewSeedPhrase);
  
  document.getElementById('btn-toggle-seed').addEventListener('click', () => {
    const input = document.getElementById('mnemonic-input');
    if (input.type === 'password') {
      input.type = 'text';
    } else {
      input.type = 'password';
    }
  });

  document.getElementById('btn-copy-seed').addEventListener('click', () => {
    const phrase = document.getElementById('mnemonic-input').value.trim();
    if (phrase) copyToClipboard(phrase);
  });

  // Derive / Restore Initial Set
  document.getElementById('btn-generate-wallets').addEventListener('click', () => {
    const count = parseInt(document.getElementById('gen-count').value, 10) || 1;
    const enableSmart = document.getElementById('gen-smart-wallet').checked;
    deriveWalletsFromSeed(count, enableSmart, false);
  });

  // + Add More Accounts (Append Mode)
  document.getElementById('btn-add-more-wallets').addEventListener('click', () => {
    const count = parseInt(document.getElementById('gen-count').value, 10) || 1;
    const enableSmart = document.getElementById('gen-smart-wallet').checked;
    deriveWalletsFromSeed(count, enableSmart, true);
  });

  // + Add Private Key Modal Triggers
  document.getElementById('btn-add-manual-key').addEventListener('click', () => {
    document.getElementById('pkey-modal-input').value = '';
    document.getElementById('pkey-modal').classList.add('active');
  });

  document.getElementById('pkey-modal-close-btn').addEventListener('click', () => {
    document.getElementById('pkey-modal').classList.remove('active');
  });

  document.getElementById('pkey-modal-cancel').addEventListener('click', () => {
    document.getElementById('pkey-modal').classList.remove('active');
  });

  document.getElementById('pkey-modal-add').addEventListener('click', addSinglePrivateKey);

  document.getElementById('btn-export-keys').addEventListener('click', exportWalletKeys);
  document.getElementById('btn-import-keys-trigger').addEventListener('click', () => {
    document.getElementById('file-import-keys').click();
  });
  document.getElementById('file-import-keys').addEventListener('change', handleImportKeys);

  document.getElementById('btn-clear-wallets').addEventListener('click', () => {
    if (confirm('Are you sure you want to remove all saved wallets? Make sure you have exported your seed phrase or private keys!')) {
      state.wallets = [];
      saveState();
      updateUI();
      showToast('All wallets cleared.', 'info');
    }
  });

  document.getElementById('btn-start-automation').addEventListener('click', startAutomationPipeline);
  document.getElementById('btn-stop-automation').addEventListener('click', stopAutomationPipeline);
  document.getElementById('btn-save-config').addEventListener('click', saveContractConfig);

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    state.logs = [];
    document.getElementById('console-logs-container').innerHTML = '';
    showToast('Logs cleared.', 'info');
  });

  document.getElementById('btn-export-logs').addEventListener('click', exportLogs);

  document.getElementById('sidebar-ref-addr').addEventListener('click', () => {
    copyToClipboard(state.config.refTarget);
  });

  const fromInput = document.getElementById('exec-from-wallet');
  const toInput = document.getElementById('exec-to-wallet');
  
  function updateRangeBadge() {
    const fromVal = Math.max(1, parseInt(fromInput.value, 10) || 1);
    const toVal = Math.max(fromVal, parseInt(toInput.value, 10) || state.wallets.length || 1);
    document.getElementById('range-summary-badge').innerText = `Processing Wallets #${fromVal} to #${toVal}`;
  }

  fromInput.addEventListener('input', updateRangeBadge);
  toInput.addEventListener('input', updateRangeBadge);

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-btn-max').addEventListener('click', fillMaxTransferAmount);
  document.getElementById('modal-btn-send').addEventListener('click', executeManualTransfer);
}

function switchTab(tabName) {
  const btn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (btn) btn.click();
}

// Generate New 12-Word Seed Phrase
function generateNewSeedPhrase() {
  const randomWallet = ethers.Wallet.createRandom();
  const phrase = randomWallet.mnemonic.phrase;
  document.getElementById('mnemonic-input').value = phrase;
  state.mnemonic = phrase;
  localStorage.setItem('opbnb_mnemonic', phrase);
  showToast('Generated new 12-Word Secret Recovery Seed Phrase!', 'success');
  addLog('SEED', 'New 12-word seed phrase generated.', 'info');
}

// Derive or Append Wallets from Seed Phrase
function deriveWalletsFromSeed(count = 5, enableSmart = true, appendMode = false) {
  let phrase = document.getElementById('mnemonic-input').value.trim();

  if (!phrase) {
    const randomWallet = ethers.Wallet.createRandom();
    phrase = randomWallet.mnemonic.phrase;
    document.getElementById('mnemonic-input').value = phrase;
  }

  let mnemonicObj;
  try {
    mnemonicObj = ethers.Mnemonic.fromPhrase(phrase);
  } catch (err) {
    showToast('Invalid 12-word seed phrase! Please check and try again.', 'error');
    return;
  }

  state.mnemonic = phrase;
  localStorage.setItem('opbnb_mnemonic', phrase);

  const startIndex = appendMode ? state.wallets.length : 0;
  const newWallets = [];

  for (let i = 0; i < count; i++) {
    const currentIndex = startIndex + i;
    const path = `m/44'/60'/0'/0/${currentIndex}`;
    const hdWallet = ethers.HDNodeWallet.fromMnemonic(mnemonicObj, path);
    const smartAddr = enableSmart ? deriveSmartWalletAddress(hdWallet.address) : hdWallet.address;

    newWallets.push({
      id: `hd_${currentIndex}_${Date.now()}`,
      index: currentIndex,
      path: path,
      address: hdWallet.address,
      privateKey: hdWallet.privateKey,
      smartWalletAddress: smartAddr,
      balance: '0.000000',
      createdTime: new Date().toISOString()
    });
  }

  if (appendMode) {
    state.wallets = [...state.wallets, ...newWallets];
    showToast(`Added ${count} more wallet(s)! (Total: ${state.wallets.length})`, 'success');
  } else {
    state.wallets = newWallets;
    showToast(`Derived ${count} wallet(s) from Seed Phrase!`, 'success');
  }

  saveState();
  updateUI();
  refreshAllBalances();
  addLog('WALLET', `${appendMode ? 'Appended' : 'Derived'} ${count} HD account(s) using path m/44'/60'/0'/0/i`, 'success');
}

// Add Single Custom Private Key
function addSinglePrivateKey() {
  const pkStr = document.getElementById('pkey-modal-input').value.trim();
  if (!pkStr) {
    showToast('Please enter a valid private key hex!', 'error');
    return;
  }

  try {
    const formattedPk = pkStr.startsWith('0x') ? pkStr : `0x${pkStr}`;
    const customWallet = new ethers.Wallet(formattedPk);
    const enableSmart = document.getElementById('gen-smart-wallet').checked;
    const smartAddr = enableSmart ? deriveSmartWalletAddress(customWallet.address) : customWallet.address;

    const newIndex = state.wallets.length;

    state.wallets.push({
      id: `custom_${newIndex}_${Date.now()}`,
      index: newIndex,
      path: 'Custom Key',
      address: customWallet.address,
      privateKey: customWallet.privateKey,
      smartWalletAddress: smartAddr,
      balance: '0.000000',
      createdTime: new Date().toISOString()
    });

    saveState();
    updateUI();
    refreshAllBalances();
    document.getElementById('pkey-modal').classList.remove('active');

    showToast(`Added custom wallet (${shortenAddress(customWallet.address)})!`, 'success');
    addLog('WALLET', `Added custom private key account #${newIndex + 1}: ${customWallet.address}`, 'success');
  } catch (err) {
    showToast('Invalid Private Key hex format!', 'error');
  }
}

// Refresh Balances for all loaded wallets
async function refreshAllBalances() {
  if (!state.provider || state.wallets.length === 0) return;

  let balanceChanged = false;

  for (let w of state.wallets) {
    try {
      const balanceWei = await state.provider.getBalance(w.address);
      const newBal = parseFloat(ethers.formatEther(balanceWei)).toFixed(6);

      if (w.balance !== newBal) {
        if (parseFloat(newBal) > parseFloat(w.balance || 0)) {
          addLog('DEPOSIT', `💰 Received deposit of ${newBal} BNB on Wallet #${w.index + 1} (${shortenAddress(w.address)})!`, 'success');
          showToast(`Deposit detected on Wallet #${w.index + 1}! (${newBal} BNB)`, 'success');
        }
        w.balance = newBal;
        balanceChanged = true;
      }
    } catch (e) {
      console.warn(`Balance check failed for ${w.address}:`, e.message);
    }
  }

  if (balanceChanged) {
    saveState();
    updateUI();
  }
}

// Update User Interface & Render Tables
function updateUI() {
  const walletCount = state.wallets.length;
  document.getElementById('nav-wallet-count').innerText = walletCount;
  document.getElementById('dash-total-wallets').innerText = walletCount;
  
  const smartCount = state.wallets.filter(w => w.smartWalletAddress && w.smartWalletAddress !== w.address).length;
  document.getElementById('dash-smart-wallets').innerText = `${smartCount} Smart Accounts`;

  let totalBalance = 0;
  let fundedCount = 0;

  state.wallets.forEach(w => {
    const b = parseFloat(w.balance || 0);
    totalBalance += b;
    if (b > 0) fundedCount++;
  });

  document.getElementById('dash-total-balance').innerText = `${totalBalance.toFixed(6)} BNB`;
  document.getElementById('dash-funded-wallets').innerText = `${fundedCount}/${walletCount} Funded`;
  document.getElementById('dash-completed-tx').innerText = state.completedTxCount;

  if (state.mnemonic) {
    document.getElementById('mnemonic-input').value = state.mnemonic;
  }

  const toInput = document.getElementById('exec-to-wallet');
  if (walletCount > 0 && (!toInput.value || parseInt(toInput.value, 10) > walletCount)) {
    toInput.value = walletCount;
    toInput.max = walletCount;
  }

  const fromVal = parseInt(document.getElementById('exec-from-wallet').value, 10) || 1;
  const toVal = parseInt(document.getElementById('exec-to-wallet').value, 10) || walletCount || 1;
  document.getElementById('range-summary-badge').innerText = `Processing Wallets #${fromVal} to #${toVal}`;

  document.getElementById('cfg-ref-target').value = state.config.refTarget;
  document.getElementById('cfg-ref-contract').value = state.config.refContract;
  document.getElementById('cfg-ref-method').value = state.config.refMethod;
  document.getElementById('cfg-ref-input').value = state.config.refInputParam || '';
  document.getElementById('cfg-nft-contract').value = state.config.nftContract;
  document.getElementById('cfg-nft-method').value = state.config.nftMethod;
  document.getElementById('cfg-nft-value').value = state.config.nftValue;
  document.getElementById('cfg-checkin-contract').value = state.config.checkinContract;
  document.getElementById('cfg-checkin-method').value = state.config.checkinMethod;

  document.getElementById('sidebar-ref-addr').innerText = shortenAddress(state.config.refTarget);
  document.getElementById('dash-ref-target-code').innerText = state.config.refTarget;

  renderWalletTable();
}

// Render Wallet Manager Table
function renderWalletTable() {
  const tbody = document.getElementById('wallet-table-body');
  if (state.wallets.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <i class="fa-solid fa-wallet-thin"></i>
            <p>No wallets derived yet. Enter a seed phrase and click "Derive / Restore Set" or "+ Add More Accounts" above.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  const currentNet = NETWORKS[state.config.selectedNetwork] || NETWORKS.mainnet;

  tbody.innerHTML = state.wallets.map((w, idx) => {
    const isFunded = parseFloat(w.balance) > 0;
    const isFirstWallet = idx === 0;

    let statusBadge = isFunded 
      ? `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Ready (${w.balance} BNB)</span>` 
      : `<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Unfunded (0 BNB)</span>`;

    if (isFirstWallet && !isFunded) {
      statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-hand-holding-dollar"></i> Deposit Gas Here</span>`;
    }

    return `
      <tr>
        <td><strong>${idx + 1}</strong></td>
        <td><code class="font-mono" style="font-size:11px">${w.path || `m/44'/60'/0'/0/${idx}`}</code></td>
        <td>
          <div class="font-mono">
            <a href="${currentNet.explorer}/address/${w.address}" target="_blank" class="tx-link">
              ${shortenAddress(w.address)}
            </a>
            <i class="fa-solid fa-copy ml-1" style="cursor:pointer; opacity:0.6" onclick="copyToClipboard('${w.address}')" title="Copy Address"></i>
            ${isFirstWallet ? `<span class="badge badge-info ml-1">1st Wallet</span>` : ''}
          </div>
        </td>
        <td>
          <div class="font-mono text-dim">
            ${w.smartWalletAddress ? shortenAddress(w.smartWalletAddress) : 'N/A'}
          </div>
        </td>
        <td>
          <strong class="${isFunded ? 'text-green' : 'text-amber'} font-mono">${w.balance} BNB</strong>
        </td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openTransferModal('${w.id}')" title="Transfer / Withdraw BNB">
            <i class="fa-solid fa-paper-plane"></i> Transfer
          </button>
          <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('${w.privateKey}')" title="Copy Private Key">
            <i class="fa-solid fa-key"></i> Key
          </button>
          <button class="btn btn-danger-outline btn-sm" onclick="deleteSingleWallet('${w.id}')" title="Delete Wallet">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Open Transfer / Withdraw Modal
function openTransferModal(walletId) {
  const wallet = state.wallets.find(w => w.id === walletId);
  if (!wallet) return;

  state.selectedTransferWallet = wallet;
  document.getElementById('modal-from-addr').value = wallet.address;
  document.getElementById('modal-from-balance').innerText = `Current Balance: ${wallet.balance} BNB`;
  document.getElementById('modal-to-addr').value = '';
  document.getElementById('modal-amount').value = '';
  
  document.getElementById('transfer-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('transfer-modal').classList.remove('active');
  state.selectedTransferWallet = null;
}

// Auto Fill Max Amount in Transfer Modal with 3x Gas Cost Reserve
async function fillMaxTransferAmount() {
  if (!state.selectedTransferWallet || !state.provider) return;

  try {
    const balanceWei = await state.provider.getBalance(state.selectedTransferWallet.address);
    const feeData = await state.provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('0.00001', 'gwei');

    const singleTxFeeWei = 21000n * gasPrice;
    const gasReserveWei = singleTxFeeWei * 3n;

    if (balanceWei <= gasReserveWei) {
      showToast('Balance too low to cover 3x gas fee reserve.', 'error');
      return;
    }

    const maxSendWei = balanceWei - gasReserveWei;
    document.getElementById('modal-amount').value = ethers.formatEther(maxSendWei);
  } catch (e) {
    showToast('Failed to calculate MAX amount.', 'error');
  }
}

// Execute Manual Transfer / Withdraw
async function executeManualTransfer() {
  const wallet = state.selectedTransferWallet;
  if (!wallet) return;

  const toAddr = document.getElementById('modal-to-addr').value.trim();
  const amountStr = document.getElementById('modal-amount').value.trim();

  if (!ethers.isAddress(toAddr)) {
    showToast('Please enter a valid opBNB recipient address!', 'error');
    return;
  }

  if (!amountStr || isNaN(amountStr) || parseFloat(amountStr) <= 0) {
    showToast('Please enter a valid amount!', 'error');
    return;
  }

  try {
    const signer = new ethers.Wallet(wallet.privateKey, state.provider);
    const amountWei = ethers.parseEther(amountStr);

    showToast('Broadcasting transaction...', 'info');

    const tx = await signer.sendTransaction({
      to: toAddr,
      value: amountWei
    });

    await tx.wait(1);

    const currentNet = NETWORKS[state.config.selectedNetwork] || NETWORKS.mainnet;
    state.completedTxCount++;
    saveState();
    closeModal();
    await refreshAllBalances();

    showToast('Transfer completed successfully!', 'success');
    addLog('TRANSFER', `Manual Transfer of ${amountStr} BNB from ${shortenAddress(wallet.address)} to ${shortenAddress(toAddr)}. Hash: <a href="${currentNet.explorer}/tx/${tx.hash}" target="_blank" class="tx-link">${shortenAddress(tx.hash)}</a>`, 'success');
  } catch (err) {
    console.error('Manual transfer error:', err);
    showToast(`Transfer failed: ${err.message}`, 'error');
  }
}

function deleteSingleWallet(id) {
  state.wallets = state.wallets.filter(w => w.id !== id);
  saveState();
  updateUI();
  showToast('Wallet removed.', 'info');
}

function exportWalletKeys() {
  if (state.wallets.length === 0) {
    showToast('No wallets to export!', 'error');
    return;
  }

  const exportData = {
    mnemonic: state.mnemonic,
    wallets: state.wallets
  };

  const jsonContent = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `opBNB_HD_Wallets_Backup_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('Exported Seed Phrase & Wallet Keys successfully!', 'success');
}

function handleImportKeys(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);

      if (imported.mnemonic) {
        document.getElementById('mnemonic-input').value = imported.mnemonic;
        state.mnemonic = imported.mnemonic;
      }

      const walletList = Array.isArray(imported) ? imported : imported.wallets;
      if (Array.isArray(walletList)) {
        let added = 0;
        walletList.forEach(item => {
          if (item.privateKey && item.address) {
            if (!state.wallets.some(w => w.address.toLowerCase() === item.address.toLowerCase())) {
              state.wallets.push({
                id: item.id || `hd_${state.wallets.length}`,
                index: item.index || state.wallets.length,
                path: item.path || `m/44'/60'/0'/0/${state.wallets.length}`,
                address: item.address,
                privateKey: item.privateKey,
                smartWalletAddress: item.smartWalletAddress || deriveSmartWalletAddress(item.address),
                balance: item.balance || '0.000000',
                createdTime: new Date().toISOString()
              });
              added++;
            }
          }
        });
        saveState();
        updateUI();
        refreshAllBalances();
        showToast(`Imported ${added} new wallet(s)!`, 'success');
      }
    } catch (err) {
      showToast('Invalid JSON backup file format.', 'error');
    }
  };
  reader.readAsText(file);
}

function saveContractConfig() {
  state.config.refTarget = document.getElementById('cfg-ref-target').value.trim();
  state.config.refContract = document.getElementById('cfg-ref-contract').value.trim();
  state.config.refMethod = document.getElementById('cfg-ref-method').value.trim();
  state.config.refInputParam = document.getElementById('cfg-ref-input').value.trim();
  state.config.nftContract = document.getElementById('cfg-nft-contract').value.trim();
  state.config.nftMethod = document.getElementById('cfg-nft-method').value.trim();
  state.config.nftValue = document.getElementById('cfg-nft-value').value.trim();
  state.config.checkinContract = document.getElementById('cfg-checkin-contract').value.trim();
  state.config.checkinMethod = document.getElementById('cfg-checkin-method').value.trim();

  saveState();
  updateUI();
  showToast('Contract settings updated successfully!', 'success');
  addLog('CONFIG', 'Contract settings updated.', 'info');
}

// AUTOMATION ENGINE LOGIC (WEB WORKER UNTHROTTLED BACKGROUND EXECUTION)
async function startAutomationPipeline() {
  if (state.wallets.length === 0) {
    showToast('Please derive at least one wallet from your seed phrase first!', 'error');
    return;
  }

  if (state.isExecuting) return;

  const fromIdxRaw = parseInt(document.getElementById('exec-from-wallet').value, 10) || 1;
  const toIdxRaw = parseInt(document.getElementById('exec-to-wallet').value, 10) || state.wallets.length;

  const fromIdx = Math.max(1, Math.min(fromIdxRaw, state.wallets.length));
  const toIdx = Math.max(fromIdx, Math.min(toIdxRaw, state.wallets.length));

  const targetWallets = state.wallets.slice(fromIdx - 1, toIdx);

  if (targetWallets.length === 0) {
    showToast('No valid wallets in the selected range!', 'error');
    return;
  }

  state.isExecuting = true;

  document.getElementById('btn-start-automation').style.display = 'none';
  document.getElementById('btn-stop-automation').style.display = 'block';
  document.getElementById('auto-engine-status').className = 'badge badge-warning';
  document.getElementById('auto-engine-status').innerText = 'Executing Tasks...';

  const enableRefer = document.getElementById('task-enable-refer').checked;
  const enableSweep = document.getElementById('task-enable-sweep').checked;
  const enableMint = document.getElementById('task-enable-mint').checked;
  const enableCheckin = document.getElementById('task-enable-checkin').checked;
  const delaySec = parseInt(document.getElementById('exec-delay').value, 10) || 30;

  const feed = document.getElementById('exec-live-feed');
  feed.innerHTML = '';

  addLog('ENGINE', `Starting background-resistant execution for Wallets #${fromIdx} to #${toIdx} with ${delaySec}s delay...`, 'info');

  const currentNet = NETWORKS[state.config.selectedNetwork] || NETWORKS.mainnet;

  for (let idx = 0; idx < targetWallets.length; idx++) {
    if (!state.isExecuting) break;

    const wData = targetWallets[idx];
    const realWalletNum = fromIdx + idx;
    const progressPercent = Math.round(((idx + 1) / targetWallets.length) * 100);

    document.getElementById('prog-task-title').innerText = `Processing Wallet #${realWalletNum} (${shortenAddress(wData.address)})`;
    document.getElementById('prog-task-percent').innerText = `${progressPercent}%`;
    document.getElementById('prog-bar-fill').style.width = `${progressPercent}%`;

    appendFeedItem(feed, `[${idx + 1}/${targetWallets.length}] Wallet #${realWalletNum}: ${shortenAddress(wData.address)} (${wData.path})`, 'info');

    try {
      const signer = new ethers.Wallet(wData.privateKey, state.provider);
      let balanceWei = await state.provider.getBalance(wData.address);

      if (balanceWei === 0n) {
        appendFeedItem(feed, `⚠️ Wallet #${realWalletNum} (${shortenAddress(wData.address)}) has 0 BNB balance.`, 'error');
        if (idx === 0) {
          addLog('WARNING', `Please deposit opBNB BNB into Wallet #${realWalletNum} (${wData.address}) to start!`, 'error');
          showToast(`Fund Wallet #${realWalletNum} (${shortenAddress(wData.address)}) with BNB first!`, 'error');
          break;
        } else {
          continue;
        }
      }

      // Task 1: Swarmbase registerWithReferral
      if (enableRefer && state.isExecuting) {
        appendFeedItem(feed, `➡️ Calling registerWithReferral on ${shortenAddress(state.config.refContract)}...`, 'info');
        await executeReferralRegister(signer, currentNet);
      }

      // Optional Module 2: Smart Dynamic NFT Mint (0x6f7cb024e5b285a9e7ee1b9d31e864e9d2b36627)
      if (enableMint && state.isExecuting) {
        appendFeedItem(feed, `➡️ Minting NFT on contract ${shortenAddress(state.config.nftContract)}...`, 'info');
        const mintResult = await executeNFTMint(signer, currentNet);
        if (!mintResult) {
          appendFeedItem(feed, `⚠️ NFT Mint call reverted on ${shortenAddress(state.config.nftContract)}. Check contract method or requirements in Settings tab.`, 'error');
        }
      }

      // Optional Module 3: Daily Check-in with Fallback Signatures (hiveCheckIn)
      if (enableCheckin && state.isExecuting) {
        appendFeedItem(feed, `➡️ Executing Daily Check-in (hiveCheckIn)...`, 'info');
        const checkinResult = await executeDailyCheckin(signer, currentNet);
        if (!checkinResult) {
          appendFeedItem(feed, `⚠️ Daily Check-in call reverted on ${shortenAddress(state.config.checkinContract)}. Check contract address or status.`, 'error');
        }
      }

      // Auto-Sweep Remaining BNB Balance to Next Wallet in Range with 3x Gas Cost Reserve!
      if (enableSweep && idx < targetWallets.length - 1 && state.isExecuting) {
        const nextWalletAddr = targetWallets[idx + 1].address;
        const nextWalletNum = realWalletNum + 1;
        appendFeedItem(feed, `💸 Transferring remaining BNB balance (reserving 3x gas fee) to Wallet #${nextWalletNum} (${shortenAddress(nextWalletAddr)})...`, 'info');
        
        const swept = await sweepRemainingBalance(signer, nextWalletAddr, currentNet);
        if (swept) {
          appendFeedItem(feed, `✅ Balance successfully passed to Wallet #${nextWalletNum}!`, 'success');
          await refreshAllBalances();
        }
      }

    } catch (err) {
      appendFeedItem(feed, `❌ Error processing wallet #${realWalletNum}: ${err.message}`, 'error');
      addLog('ERROR', `Wallet #${realWalletNum} error: ${err.message}`, 'error');
    }

    if (idx < targetWallets.length - 1 && state.isExecuting) {
      appendFeedItem(feed, `⏳ Waiting ${delaySec}s delay in background thread...`, 'info');
      await backgroundSleep(delaySec * 1000);
    }
  }

  finishAutomationPipeline();
}

// Auto-Sweep Remaining BNB Balance Helper with 3x Gas Reserve Buffer
async function sweepRemainingBalance(signer, nextWalletAddress, network) {
  try {
    const balanceWei = await state.provider.getBalance(signer.address);
    if (balanceWei <= 0n) return false;

    const feeData = await state.provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('0.00001', 'gwei');

    const singleTxFeeWei = 21000n * gasPrice;
    const gasReserveWei = singleTxFeeWei * 3n;

    if (balanceWei <= gasReserveWei) {
      addLog('SWEEP', `Balance too small to cover 3x gas fee reserve. Skipping sweep.`, 'error');
      return false;
    }

    const sendAmountWei = balanceWei - gasReserveWei;
    const sendAmountEther = ethers.formatEther(sendAmountWei);

    const tx = await signer.sendTransaction({
      to: nextWalletAddress,
      value: sendAmountWei,
      gasLimit: 21000n,
      gasPrice: gasPrice
    });

    await tx.wait(1);

    state.completedTxCount++;
    saveState();
    updateUI();

    const txHash = tx.hash;
    addLog('SWEEP', `💸 Auto-swept ${parseFloat(sendAmountEther).toFixed(5)} BNB to Wallet (${shortenAddress(nextWalletAddress)}). Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'success');
    return true;
  } catch (err) {
    console.error('Sweep remaining balance error:', err);
    addLog('ERROR', `Auto-sweep balance failed: ${err.message}`, 'error');
    return false;
  }
}

function stopAutomationPipeline() {
  state.isExecuting = false;
  if (state.bgWorker) state.bgWorker.postMessage({ action: 'cancel' });
  showToast('Automation engine stopped.', 'info');
  addLog('ENGINE', 'Automation batch stopped by user.', 'error');
  finishAutomationPipeline();
}

function finishAutomationPipeline() {
  state.isExecuting = false;
  document.getElementById('btn-start-automation').style.display = 'block';
  document.getElementById('btn-stop-automation').style.display = 'none';
  document.getElementById('auto-engine-status').className = 'badge badge-success';
  document.getElementById('auto-engine-status').innerText = 'Engine Ready';
  showToast('Task execution completed for selected range!', 'success');
  addLog('ENGINE', 'Range task execution completed.', 'success');
}

// Step 1 Execution: Robust registerWithReferral Call with Fallbacks
async function executeReferralRegister(signer, network) {
  const contractAddr = state.config.refContract.trim();
  const refTarget = state.config.refTarget.trim();
  const inputStr = state.config.refInputParam || "";

  try {
    const methodSig = state.config.refMethod.trim();
    const iface = new ethers.Interface([`function ${methodSig}`]);
    const funcName = methodSig.split('(')[0];
    const funcObj = iface.getFunction(funcName);

    let calldata;
    if (funcObj.inputs.length === 2) {
      const p1 = funcObj.inputs[0].type === 'address' ? refTarget : inputStr;
      const p2 = funcObj.inputs[1].type === 'address' ? refTarget : inputStr;
      calldata = iface.encodeFunctionData(funcName, [p1, p2]);
    } else {
      calldata = iface.encodeFunctionData(funcName, [refTarget]);
    }

    const tx = await signer.sendTransaction({
      to: contractAddr,
      data: calldata
    });

    await tx.wait(1);

    state.completedTxCount++;
    saveState();
    updateUI();

    const txHash = tx.hash;
    addLog('TX', `✅ registerWithReferral Executed! Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'tx');
    showToast('registerWithReferral broadcasted!', 'success');
    return true;
  } catch (primaryErr) {
    console.warn('Primary method failed, trying fallback registerWithReferral(address)...', primaryErr);

    try {
      const fallbackIface = new ethers.Interface(['function registerWithReferral(address)']);
      const calldata = fallbackIface.encodeFunctionData('registerWithReferral', [refTarget]);

      const tx = await signer.sendTransaction({
        to: contractAddr,
        data: calldata
      });

      await tx.wait(1);

      state.completedTxCount++;
      saveState();
      updateUI();

      const txHash = tx.hash;
      addLog('TX', `✅ registerWithReferral (Fallback 1-Param) Executed! Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'tx');
      showToast('registerWithReferral fallback succeeded!', 'success');
      return true;
    } catch (fallbackErr) {
      console.error('Fallback referral registration failed:', fallbackErr);
      addLog('ERROR', `registerWithReferral failed: ${fallbackErr.message}`, 'error');
      return false;
    }
  }
}

// Step 2 Execution: Smart Dynamic NFT Mint Call with Target Contract 0x6f7cb024e5b285a9e7ee1b9d31e864e9d2b36627
async function executeNFTMint(signer, network) {
  const contractAddr = state.config.nftContract.trim() || '0x6f7cb024e5b285a9e7ee1b9d31e864e9d2b36627';
  const configuredMethod = state.config.nftMethod.trim();
  const valueWei = ethers.parseEther(state.config.nftValue || '0');

  // Direct Raw Hex Calldata Check (e.g., 0x12345678)
  if (configuredMethod.startsWith('0x')) {
    try {
      const tx = await signer.sendTransaction({
        to: contractAddr,
        data: configuredMethod,
        value: valueWei
      });
      await tx.wait(1);
      state.completedTxCount++;
      saveState();
      updateUI();
      const txHash = tx.hash;
      addLog('TX', `✅ NFT Minted via Raw Hex! Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'tx');
      showToast('NFT Minted successfully!', 'success');
      return true;
    } catch (err) {
      addLog('ERROR', `Raw Hex NFT Mint failed: ${err.message}`, 'error');
      return false;
    }
  }

  const candidateSignatures = [
    configuredMethod,
    'mint()',
    'mint(address)',
    'safeMint(address)',
    'mintNFT()',
    'publicMint()',
    'claim()'
  ];

  const methodList = [...new Set(candidateSignatures)];

  for (let methodSig of methodList) {
    try {
      const iface = new ethers.Interface([`function ${methodSig}`]);
      const funcName = methodSig.split('(')[0];
      const funcObj = iface.getFunction(funcName);

      let calldata;
      if (funcObj.inputs.length === 1) {
        if (funcObj.inputs[0].type === 'address') {
          calldata = iface.encodeFunctionData(funcName, [signer.address]);
        } else if (funcObj.inputs[0].type.includes('int')) {
          calldata = iface.encodeFunctionData(funcName, [1]);
        } else {
          calldata = iface.encodeFunctionData(funcName, [signer.address]);
        }
      } else {
        calldata = iface.encodeFunctionData(funcName, []);
      }

      const tx = await signer.sendTransaction({
        to: contractAddr,
        data: calldata,
        value: valueWei
      });

      await tx.wait(1);

      state.completedTxCount++;
      saveState();
      updateUI();

      const txHash = tx.hash;
      addLog('TX', `✅ NFT Minted (${methodSig})! Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'tx');
      showToast('NFT Minted successfully!', 'success');
      return true;
    } catch (err) {
      console.warn(`Mint method ${methodSig} failed, trying next candidate...`, err.message);
    }
  }

  addLog('ERROR', `NFT Minting failed on contract ${shortenAddress(contractAddr)}. Check NFT Contract Address & Method in Contract Settings tab.`, 'error');
  return false;
}

// Step 3 Execution: Swarmbase Daily Check-in Call (hiveCheckIn)
async function executeDailyCheckin(signer, network) {
  const contractAddr = state.config.checkinContract.trim();
  const configuredMethod = state.config.checkinMethod.trim() || 'hiveCheckIn()';

  // Direct Raw Hex Calldata Check (e.g., 0x12345678)
  if (configuredMethod.startsWith('0x')) {
    try {
      const tx = await signer.sendTransaction({
        to: contractAddr,
        data: configuredMethod
      });
      await tx.wait(1);
      state.completedTxCount++;
      saveState();
      updateUI();
      const txHash = tx.hash;
      addLog('TX', `✅ Daily Check-in (Raw Hex) Completed! Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'tx');
      showToast('Daily Check-in completed successfully!', 'success');
      return true;
    } catch (err) {
      addLog('ERROR', `Raw Hex Daily Check-in failed: ${err.message}`, 'error');
      return false;
    }
  }

  const fallbackSignatures = [
    configuredMethod,
    'hiveCheckIn()',
    'hiveCheckin()',
    'hiveCheckIn(address)',
    'checkIn()',
    'checkin()',
    'dailyCheckIn()',
    'claim()',
    'claimReward()'
  ];

  const methodList = [...new Set(fallbackSignatures)];

  for (let methodSig of methodList) {
    try {
      const iface = new ethers.Interface([`function ${methodSig}`]);
      const funcName = methodSig.split('(')[0];
      const funcObj = iface.getFunction(funcName);

      let calldata;
      if (funcObj.inputs.length === 1) {
        if (funcObj.inputs[0].type === 'address') {
          calldata = iface.encodeFunctionData(funcName, [signer.address]);
        } else {
          calldata = iface.encodeFunctionData(funcName, [""]);
        }
      } else {
        calldata = iface.encodeFunctionData(funcName, []);
      }

      const tx = await signer.sendTransaction({
        to: contractAddr,
        data: calldata
      });

      await tx.wait(1);

      state.completedTxCount++;
      saveState();
      updateUI();

      const txHash = tx.hash;
      addLog('TX', `✅ Daily Check-in (${methodSig}) Completed! Hash: <a href="${network.explorer}/tx/${txHash}" target="_blank" class="tx-link">${shortenAddress(txHash)}</a>`, 'tx');
      showToast('Daily Check-in completed successfully!', 'success');
      return true;
    } catch (err) {
      console.warn(`Check-in method ${methodSig} failed, trying next fallback...`, err.message);
    }
  }

  addLog('ERROR', `Daily Check-in failed on contract ${shortenAddress(contractAddr)}. Check Check-in Contract Address & Method in Contract Settings tab.`, 'error');
  return false;
}

// Helper Utilities
function shortenAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  });
}

function appendFeedItem(container, text, type = 'info') {
  const item = document.createElement('div');
  item.className = `feed-item ${type}`;
  item.innerHTML = `<span class="font-mono">${new Date().toLocaleTimeString()}</span> <span>${text}</span>`;
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function addLog(tag, message, type = 'info') {
  const logContainer = document.getElementById('console-logs-container');
  const timestamp = new Date().toLocaleTimeString();
  
  const tagClass = {
    info: 'tag-info',
    success: 'tag-success',
    error: 'tag-error',
    tx: 'tag-tx'
  }[type] || 'tag-info';

  const logRow = document.createElement('div');
  logRow.className = `console-row ${type}`;
  logRow.innerHTML = `
    <span class="log-time">[${timestamp}]</span>
    <span class="log-tag ${tagClass}">${tag}</span>
    <span class="log-msg">${message}</span>
  `;

  logContainer.appendChild(logRow);
  logContainer.scrollTop = logContainer.scrollHeight;

  state.logs.push({ timestamp, tag, message, type });
}

function exportLogs() {
  if (state.logs.length === 0) {
    showToast('No logs to export!', 'error');
    return;
  }
  const textContent = state.logs.map(l => `[${l.timestamp}] [${l.tag}] ${l.message.replace(/<[^>]*>?/gm, '')}`).join('\n');
  const blob = new Blob([textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `opBNB_Logs_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// Toast Notification Engine
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: 'fa-circle-check text-green',
    error: 'fa-circle-xmark text-red',
    info: 'fa-circle-info text-blue'
  };

  toast.innerHTML = `
    <i class="fa-solid ${icons[type] || 'fa-bell'}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
