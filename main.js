const API_URL = 'http://localhost:3000/api';

const assignmentGrid = document.getElementById('assignment-grid');
const submitModal = document.getElementById('submit-modal');
const openSubmitBtn = document.getElementById('open-submit-btn');
const closeBtn = document.querySelector('.close-btn');
const assignmentForm = document.getElementById('assignment-form');
const refreshBtn = document.getElementById('refresh-btn');

// --- Modal Logic ---
openSubmitBtn.onclick = () => submitModal.style.display = 'block';
closeBtn.onclick = () => submitModal.style.display = 'none';
window.onclick = (event) => {
    if (event.target == submitModal) submitModal.style.display = 'none';
};

// --- Fetch & Render Assignments ---
async function fetchAssignments() {
    try {
        const response = await fetch(`${API_URL}/assignments`);
        if (!response.ok) throw new Error('Failed to fetch');
        const assignments = await response.json();
        renderAssignments(assignments);
    } catch (error) {
        console.error('Error:', error);
        assignmentGrid.innerHTML = '<div class="loading-state">无法加载作业，请检查服务器是否已启动。</div>';
    }
}

function renderAssignments(assignments) {
    if (assignments.length === 0) {
        assignmentGrid.innerHTML = '<div class="loading-state">目前还没有人上交作业，快来做第一个吧！</div>';
        return;
    }

    assignmentGrid.innerHTML = assignments.map((work, index) => `
        <div class="card" style="animation-delay: ${index * 0.1}s">
            <div class="card-header">
                <div class="card-title">${escapeHtml(work.title)}</div>
                <span class="student-badge">${escapeHtml(work.student_name)}</span>
            </div>
            <div class="card-content">
                ${escapeHtml(work.content)}
            </div>
            <div class="card-footer">
                <span class="timestamp">${work.timestamp}</span>
            </div>
        </div>
    `).join('');
}

// --- Form Submission ---
assignmentForm.onsubmit = async (e) => {
    e.preventDefault();
    
    const submitBtn = assignmentForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerText;
    submitBtn.innerText = '正在提交...';
    submitBtn.disabled = true;

    const formData = {
        studentName: document.getElementById('studentName').value,
        title: document.getElementById('title').value,
        content: document.getElementById('content').value
    };

    try {
        const response = await fetch(`${API_URL}/assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            assignmentForm.reset();
            submitModal.style.display = 'none';
            fetchAssignments(); // Refresh list
        } else {
            alert('提交失败，请重试');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('连接服务器失败');
    } finally {
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
    }
};

// --- Helpers ---
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

refreshBtn.onclick = fetchAssignments;

// Initialize
fetchAssignments();
// Auto-refresh every 30 seconds
setInterval(fetchAssignments, 30000);
