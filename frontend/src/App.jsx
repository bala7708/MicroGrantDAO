import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

// ── ABI stubs (replace with actual compiled artifacts) ─────────────────────
const DAO_ABI = [
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256) view returns (tuple(uint256 id, address proposer, address recipient, uint256 amount, string title, string description, string category, string ipfsHash, uint256 createdAt, uint256 voteStart, uint256 voteEnd, uint256 executionTime, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, uint8 status, bool flaggedByCurator))",
  "function getVoteStats(uint256) view returns (uint256, uint256, uint256, uint256, uint256, bool)",
  "function createProposal(address, uint256, string, string, string, string) returns (uint256)",
  "function castVote(uint256, uint8)",
  "function activateVoting(uint256)",
  "function finalizeProposal(uint256)",
  "function executeProposal(uint256)",
  "function hasVoted(uint256, address) view returns (bool)",
  "event ProposalCreated(uint256 indexed id, address indexed proposer, address recipient, uint256 amount, string title, string category)",
  "event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 choice, uint256 weight)",
];

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function delegate(address)",
  "function delegates(address) view returns (address)",
];

const ADDRESSES = {
  dao:   "0x0000000000000000000000000000000000000000", // Replace after deploy
  token: "0x0000000000000000000000000000000000000000",
};

const STATUS_LABELS = ["PENDING", "ACTIVE", "PASSED", "REJECTED", "EXECUTED", "CANCELLED"];
const STATUS_COLORS = {
  PENDING:   "bg-yellow-100 text-yellow-800",
  ACTIVE:    "bg-blue-100 text-blue-800",
  PASSED:    "bg-green-100 text-green-800",
  REJECTED:  "bg-red-100 text-red-800",
  EXECUTED:  "bg-purple-100 text-purple-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

// ── Components ─────────────────────────────────────────────────────────────
function Badge({ status }) {
  const label = STATUS_LABELS[status] || "UNKNOWN";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[label]}`}>
      {label}
    </span>
  );
}

function VoteBar({ forVotes, againstVotes, abstainVotes }) {
  const total = forVotes + againstVotes + abstainVotes || 1;
  const forPct = (forVotes / total) * 100;
  const againstPct = (againstVotes / total) * 100;
  return (
    <div className="mt-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-200">
        <div className="bg-green-500" style={{ width: `${forPct}%` }} />
        <div className="bg-red-400" style={{ width: `${againstPct}%` }} />
        <div className="bg-gray-400" style={{ width: `${100 - forPct - againstPct}%` }} />
      </div>
      <div className="flex text-xs mt-1 gap-3 text-gray-500">
        <span>✅ {forPct.toFixed(1)}% For</span>
        <span>❌ {againstPct.toFixed(1)}% Against</span>
        <span>⬜ {(100 - forPct - againstPct).toFixed(1)}% Abstain</span>
      </div>
    </div>
  );
}

function ProposalCard({ proposal, onVote, onActivate, onFinalize, onExecute, userVoted }) {
  const amount = ethers.formatEther(proposal.amount);
  const status = STATUS_LABELS[proposal.status];
  const now = Math.floor(Date.now() / 1000);
  const canActivate = status === "PENDING" && now >= Number(proposal.voteStart);
  const canFinalize = status === "ACTIVE" && now > Number(proposal.voteEnd);
  const canExecute = status === "PASSED" && now >= Number(proposal.executionTime);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-gray-900 text-lg leading-tight">{proposal.title}</h3>
        <Badge status={proposal.status} />
      </div>
      <p className="text-sm text-gray-500 mb-1">
        <span className="font-medium text-indigo-600">{amount} ETH</span> · {proposal.category}
      </p>
      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{proposal.description}</p>

      <div className="text-xs text-gray-400 mb-3">
        Grantee: <span className="font-mono">{proposal.recipient.slice(0, 8)}…{proposal.recipient.slice(-6)}</span>
      </div>

      <VoteBar
        forVotes={Number(ethers.formatEther(proposal.forVotes))}
        againstVotes={Number(ethers.formatEther(proposal.againstVotes))}
        abstainVotes={Number(ethers.formatEther(proposal.abstainVotes))}
      />

      <div className="mt-4 flex gap-2 flex-wrap">
        {canActivate && (
          <button onClick={() => onActivate(proposal.id)}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Activate Voting
          </button>
        )}
        {status === "ACTIVE" && !userVoted && (
          <>
            <button onClick={() => onVote(proposal.id, 1)}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
              Vote For
            </button>
            <button onClick={() => onVote(proposal.id, 0)}
              className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600">
              Vote Against
            </button>
            <button onClick={() => onVote(proposal.id, 2)}
              className="px-3 py-1.5 text-xs bg-gray-400 text-white rounded-lg hover:bg-gray-500">
              Abstain
            </button>
          </>
        )}
        {userVoted && status === "ACTIVE" && (
          <span className="text-xs text-gray-400 italic py-1.5">You voted ✓</span>
        )}
        {canFinalize && (
          <button onClick={() => onFinalize(proposal.id)}
            className="px-3 py-1.5 text-xs bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">
            Finalize
          </button>
        )}
        {canExecute && (
          <button onClick={() => onExecute(proposal.id)}
            className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700">
            Execute Grant
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [daoContract, setDaoContract] = useState(null);
  const [tokenContract, setTokenContract] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [tokenBalance, setTokenBalance] = useState("0");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [userVotes, setUserVotes] = useState({});
  const [form, setForm] = useState({
    recipient: "", amount: "", title: "", description: "", category: "Public Goods", ipfsHash: ""
  });

  const connect = async () => {
    if (!window.ethereum) return alert("Install MetaMask!");
    const _provider = new ethers.BrowserProvider(window.ethereum);
    const _signer = await _provider.getSigner();
    const _account = await _signer.getAddress();
    const _dao = new ethers.Contract(ADDRESSES.dao, DAO_ABI, _signer);
    const _token = new ethers.Contract(ADDRESSES.token, TOKEN_ABI, _signer);
    setProvider(_provider); setSigner(_signer); setAccount(_account);
    setDaoContract(_dao); setTokenContract(_token);
    setStatus("Wallet connected!");
  };

  const loadProposals = useCallback(async () => {
    if (!daoContract) return;
    const count = await daoContract.proposalCount();
    const loaded = [];
    const votes = {};
    for (let i = 1; i <= Number(count); i++) {
      const p = await daoContract.getProposal(i);
      loaded.push(p);
      if (account) {
        votes[i] = await daoContract.hasVoted(i, account);
      }
    }
    setProposals([...loaded].reverse());
    setUserVotes(votes);
  }, [daoContract, account]);

  const loadTokenBalance = useCallback(async () => {
    if (!tokenContract || !account) return;
    const bal = await tokenContract.balanceOf(account);
    setTokenBalance(ethers.formatEther(bal));
  }, [tokenContract, account]);

  useEffect(() => {
    if (daoContract) { loadProposals(); loadTokenBalance(); }
  }, [daoContract, loadProposals, loadTokenBalance]);

  const tx = async (fn, ...args) => {
    try {
      setLoading(true);
      setStatus("Sending transaction…");
      const t = await fn(...args);
      setStatus("Waiting for confirmation…");
      await t.wait();
      setStatus("✅ Transaction confirmed!");
      loadProposals();
    } catch (e) {
      setStatus(`❌ ${e.reason || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const submitProposal = async (e) => {
    e.preventDefault();
    await tx(
      daoContract.createProposal,
      form.recipient,
      ethers.parseEther(form.amount),
      form.title,
      form.description,
      form.category,
      form.ipfsHash || "QmPlaceholder"
    );
    setShowForm(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">MG</div>
            <span className="font-bold text-gray-900 text-lg">MicroGrant DAO</span>
          </div>
          <div className="flex items-center gap-3">
            {account && (
              <span className="text-sm text-gray-500">
                {parseFloat(tokenBalance).toFixed(0)} MGRANT · <span className="font-mono">{account.slice(0,6)}…{account.slice(-4)}</span>
              </span>
            )}
            {!account ? (
              <button onClick={connect}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700">
                Connect Wallet
              </button>
            ) : (
              <button onClick={() => setShowForm(!showForm)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700">
                + New Proposal
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Status */}
        {status && (
          <div className="mb-4 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-sm text-indigo-700">
            {status}
          </div>
        )}

        {/* New Proposal Form */}
        {showForm && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-4">Submit Grant Proposal</h2>
            <form onSubmit={submitProposal} className="space-y-3">
              <input required placeholder="Grant Title"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
              <input required placeholder="Recipient Address (0x...)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                value={form.recipient} onChange={e => setForm({...form, recipient: e.target.value})} />
              <div className="flex gap-3">
                <input required type="number" step="0.01" placeholder="ETH Amount"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} />
                <select className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                  {["Public Goods","DeFi","Education","Infrastructure","Research","Community"].map(c =>
                    <option key={c}>{c}</option>
                  )}
                </select>
              </div>
              <textarea required placeholder="Description (max 500 chars)" rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                maxLength={500}
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              <input placeholder="IPFS Hash (optional)"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                value={form.ipfsHash} onChange={e => setForm({...form, ipfsHash: e.target.value})} />
              <div className="flex gap-2">
                <button type="submit" disabled={loading}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  Submit
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Proposals */}
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Active Proposals <span className="text-gray-400 font-normal text-base">({proposals.length})</span>
        </h2>

        {proposals.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">🏛️</div>
            <p>No proposals yet. Connect your wallet and submit one!</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {proposals.map(p => (
            <ProposalCard
              key={p.id}
              proposal={p}
              userVoted={userVotes[Number(p.id)]}
              onVote={(id, choice) => tx(daoContract.castVote, id, choice)}
              onActivate={(id) => tx(daoContract.activateVoting, id)}
              onFinalize={(id) => tx(daoContract.finalizeProposal, id)}
              onExecute={(id) => tx(daoContract.executeProposal, id)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
