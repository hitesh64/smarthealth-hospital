// Health Blog page (patient site): articles filtered by topic, and a card of everyday health tips.
// Uses switchView() from the main page script and filterCategory() / dashScrollTo() from dashboard.js.

const BL_TOPICS = [
    { key: 'All', icon: 'fa-layer-group' },
    { key: 'Facility', icon: 'fa-hospital', tone: '#dc2626' },
    { key: 'Diagnostics', icon: 'fa-vial', tone: '#0d9488' },
    { key: 'Wellness', icon: 'fa-leaf', tone: '#2563eb' }
];

const BL_POSTS = [
    {
        topic: 'Facility', title: 'Advanced Cardiology Center',
        text: 'Our state-of-the-art cardiology wing provides 24/7 ECG, Angiography, and minimally invasive heart bypass surgeries.',
        img: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=900&q=75',
        cta: 'Find a cardiologist', run: () => { switchView('home'); filterCategory('Cardiology'); dashScrollTo('dash-doctors'); }
    },
    {
        topic: 'Diagnostics', title: '24x7 AI-Integrated Pathology Lab',
        text: 'Experience ultra-fast, accurate diagnostics with our newly upgraded pathology labs. We offer MRI, CT Scans, and comprehensive blood panels.',
        img: 'https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?w=900&q=75',
        cta: 'Book an appointment', run: () => { switchView('home'); dashScrollTo('dash-doctors'); }
    },
    {
        topic: 'Wellness', title: 'Nutrition & Diet: Preventing Modern Diseases',
        text: 'A balanced diet is your first line of defense against lifestyle diseases like Type-2 Diabetes and Hypertension.',
        img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=75',
        cta: 'Check your symptoms', run: () => switchView('ai-checker')
    }
];

// General everyday habits, not medical advice for any one person
const BL_TIPS = [
    ['Keep water within reach', 'Sip through the day instead of waiting until you feel thirsty.'],
    ['Protect your sleep', 'Most adults do best on seven to eight hours, at roughly the same time each night.'],
    ['Walk for thirty minutes', 'A brisk walk on most days is one of the simplest things you can do for your heart.'],
    ['Fill half the plate with vegetables', 'Add fruit and whole grains, and go easy on salt, sugar and fried food.'],
    ['Wash hands for twenty seconds', 'Soap and water before eating and after coming home stops many common infections.'],
    ['Take medicines as prescribed', 'Finish the course your doctor gave you, and do not share or reuse old prescriptions.'],
    ['Do not skip check-ups', 'Blood pressure and sugar can rise without symptoms. A routine check catches them early.']
];

const blog = { topic: 'All', tip: Math.floor(Date.now() / 86400000) % BL_TIPS.length };

function blTone(topic) {
    return (BL_TOPICS.find(t => t.key === topic) || {}).tone || '#2563eb';
}

function blMoveGlider() {
    const active = document.querySelector('.bl-tab.active'), glider = document.querySelector('.bl-glider');
    if (!active || !glider) return;
    glider.style.width = active.offsetWidth + 'px';
    glider.style.transform = `translateX(${active.offsetLeft}px)`;
}
window.addEventListener('resize', blMoveGlider);

function blRun(i) { BL_POSTS[i].run(); }

function blTopic(topic) {
    blog.topic = topic;
    blRender();
}

function blTipHtml(dir) {
    const [title, text] = BL_TIPS[blog.tip];
    return `<div class="bl-tip-text ${dir ? 'is-' + dir : ''}" id="blTipText"><b>${title}</b><span>${text}</span></div>`;
}

// Steps through the tips; the text slides in from the side you moved towards
function blTip(step) {
    blog.tip = (blog.tip + step + BL_TIPS.length) % BL_TIPS.length;
    document.getElementById('blTipText').outerHTML = blTipHtml(step > 0 ? 'next' : 'prev');
    document.querySelectorAll('.bl-dots i').forEach((dot, i) => dot.classList.toggle('on', i === blog.tip));
}

// Called by switchView('blog') and by the topic buttons
function blRender() {
    const tabs = document.getElementById('blTabs');
    if (!tabs.children.length) {
        tabs.innerHTML = '<span class="bl-glider"></span>' + BL_TOPICS.map(t =>
            `<button type="button" class="bl-tab" data-topic="${t.key}" onclick="blTopic('${t.key}')"><i class="fas ${t.icon}"></i>${t.key === 'All' ? 'All topics' : t.key}</button>`).join('');
    }
    tabs.querySelectorAll('.bl-tab').forEach(b => b.classList.toggle('active', b.dataset.topic === blog.topic));
    blMoveGlider();

    const posts = BL_POSTS.map((p, i) => ({ ...p, i })).filter(p => blog.topic === 'All' || p.topic === blog.topic);
    const card = (p, n) => `
        <article class="bl-card ${n ? '' : 'is-lead'}" style="--tone: ${blTone(p.topic)}; --i: ${n};">
            <div class="bl-photo"><span class="bl-tag">${p.topic}</span><img src="${p.img}" alt="" loading="lazy"></div>
            <div class="bl-body">
                ${n ? '' : '<span class="bl-kicker">Featured</span>'}
                <h3>${p.title}</h3>
                <p>${p.text}</p>
                <button type="button" class="bl-link" onclick="blRun(${p.i})">${p.cta}<i class="fas fa-arrow-right"></i></button>
            </div>
        </article>`;
    const tip = `
        <aside class="bl-tip">
            <span class="bl-tip-label"><i class="fas fa-lightbulb"></i>Health tip</span>
            ${blTipHtml()}
            <div class="bl-tip-foot">
                <span class="bl-dots">${BL_TIPS.map((t, i) => `<i class="${i === blog.tip ? 'on' : ''}"></i>`).join('')}</span>
                <button type="button" aria-label="Previous tip" onclick="blTip(-1)"><i class="fas fa-chevron-left"></i></button>
                <button type="button" aria-label="Next tip" onclick="blTip(1)"><i class="fas fa-chevron-right"></i></button>
            </div>
        </aside>`;
    const ask = `
        <div class="bl-ask" style="--i: ${posts.length};">
            <i class="fas fa-user-doctor"></i>
            <b>Have a question about your own health?</b>
            <p>An article cannot examine you. A doctor can.</p>
            <div class="bl-ask-actions">
                <button type="button" class="ap-btn" onclick="switchView('home'); dashScrollTo('dash-doctors')"><i class="fas fa-calendar-plus"></i>Find a doctor</button>
                <button type="button" class="ap-btn" onclick="switchView('ai-checker')"><i class="fas fa-stethoscope"></i>Check symptoms</button>
            </div>
        </div>`;
    // lead article, then the tip beside it, then the rest
    document.getElementById('blGrid').innerHTML = posts.length
        ? card(posts[0], 0) + tip + posts.slice(1).map((p, n) => card(p, n + 1)).join('') + ask
        : tip + ask;
}
