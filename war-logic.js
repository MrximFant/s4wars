window.warRoom = function() {
    return {
        // --- CONFIG ---
        version: '2.5.5',
        sbUrl: 'https://kjyikmetuciyoepbdzuz.supabase.co',
        sbKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeWlrbWV0dWNpeW9lcGJkenV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNTMyNDUsImV4cCI6MjA4MjkyOTI0NX0.0bxEk7nmkW_YrlVsCeLqq8Ewebc2STx4clWgCfJus48',

        // --- STATE ---
        tab: 'warroom', loading: true, mobileMenu: false, searchQuery: '', refSearch: '', debugStatus: 'Ready',
        alliances: [], players: [], openGroups: [], openServers: [], openAlliances: [],
        authenticated: false, passInput: '', managerName: '',
        importData: '', isImporting: false,
        rateMode: localStorage.getItem('war_rate_mode') || 'auto',
        displayClock: '', currentRoundText: '', currentPhase: '', phaseCountdown: '',
        
        // FIXED SEASON ANCHOR: Monday, Jan 5, 2026, 03:00 CET
        seasonStart: new Date("2026-01-05T03:00:00+01:00"), 

        async init() {
            const storedVersion = localStorage.getItem('war_app_version');
            if (storedVersion !== this.version) {
                localStorage.clear();
                localStorage.setItem('war_app_version', this.version);
                window.location.reload(); return;
            }
            this.client = supabase.createClient(this.sbUrl, this.sbKey);
            this.myAllianceName = localStorage.getItem('war_ref_alliance') || '';
            
            await this.fetchData();

            if (this.myAllianceName) {
                const me = this.alliances.find(a => a.name === this.myAllianceName);
                if (me) {
                    const groups = this.getGroupedFaction(me.faction);
                    const myG = groups.find(g => g.alliances.some(x => x.id === me.id));
                    if (myG) this.openGroups.push(`${me.faction}-${myG.id}`);
                }
            }

            const savedKey = localStorage.getItem('war_admin_key');
            if (savedKey) { this.passInput = savedKey; await this.login(true); }

            this.updateClock();
            setInterval(() => this.updateClock(), 1000);
        },

        async fetchData() {
            this.loading = true;
            try {
                const [resM, resP] = await Promise.all([
                    this.client.from('war_master_view').select('*'),
                    this.client.from('players').select('*').order('thp', { ascending: false })
                ]);
                this.alliances = resM.data || [];
                this.players = resP.data || [];
                this.debugStatus = `Strategic Intel Online`;
            } catch (e) { this.debugStatus = "Sync Error"; }
            this.loading = false;
        },

        // --- MATH ENGINE ---
        get factionData() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            const warTime = this.getNextWarTime();

            return this.alliances.map(a => {
                let rate = (this.rateMode === 'static') ? Number(a.city_rate || 0) : (Number(a.observed_rate) > 0 ? Number(a.observed_rate) : Number(a.city_rate || 0));
                const lastScout = a.last_scout_time ? new Date(a.last_scout_time) : cet;
                const hoursSinceScout = Math.max(0, (cet - lastScout) / 3600000);
                const hoursUntilWar = Math.max(0, (warTime - cet) / 3600000);
                const currentStash = Number(a.last_copper || 0) + (rate * hoursSinceScout);
                const warStash = currentStash + (rate * hoursUntilWar);
                return { ...a, stash: currentStash, warStash: warStash, rate: rate, isObserved: (this.rateMode === 'auto' && Number(a.observed_rate) > 0) };
            });
        },

        getNextWarTime() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            let target = new Date(cet);
            const day = cet.getDay(); const hr = cet.getHours(); const min = cet.getMinutes();

            if (day < 3 || (day === 3 && (hr < 15 || (hr === 15 && min < 30)))) { target.setDate(cet.getDate() + (3 - day)); } 
            else if (day < 6 || (day === 6 && (hr < 15 || (hr === 15 && min < 30)))) { target.setDate(cet.getDate() + (6 - day)); } 
            else { target.setDate(cet.getDate() + (7 - day + 3)); }
            target.setHours(15, 30, 0, 0); return target;
        },

        updateClock() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            this.displayClock = cet.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'});

            // PRE-SEASON CHECK
            if (cet < this.seasonStart) {
                this.currentRoundText = "PRE-SEASON";
                this.currentPhase = "Awaiting Season Launch";
                this.week = 1;
                const dff = this.seasonStart - cet;
                this.phaseCountdown = `${Math.floor(dff/864e5)}d : ${Math.floor((dff%864e5)/36e5)}h : ${Math.floor((dff%36e5)/6e4)}m`;
                return;
            }

            const diffDays = Math.floor((cet - this.seasonStart) / 864e5);
            this.week = Math.max(1, Math.min(4, Math.floor(diffDays / 7) + 1));
            const day = cet.getDay(); const hr = cet.getHours(); const min = cet.getMinutes();

            const isR1 = (day >= 1 && day < 4 && !(day === 4 && hr >= 3));
            this.currentRoundText = `Week ${this.week} | Round ${isR1 ? 1 : 2}`;

            let phase = ""; let target = new Date(cet);
            if (isR1) {
                if (day === 1 || (day === 2 && hr < 3)) { phase = "Grouping Phase"; target.setDate(cet.getDate() + (day === 1 ? 1 : 0)); target.setHours(3,0,0,0); }
                else if (day === 2 || (day === 3 && hr < 3)) { phase = "Declaration Stage"; target.setDate(cet.getDate() + (day === 2 ? 1 : 0)); target.setHours(3,0,0,0); }
                else if (day === 3 && hr < 15) { phase = "Invitation Phase"; target.setHours(15,0,0,0); }
                else if (day === 3 && hr === 15 && min < 30) { phase = "Preparation"; target.setHours(15,30,0,0); }
                else { phase = "WAR ACTIVE"; target.setDate(cet.getDate() + (4-day)); target.setHours(3,0,0,0); }
            } else {
                if (day === 4 || (day === 5 && hr < 3)) { phase = "Grouping Phase"; target.setDate(cet.getDate() + (day === 4 ? 1 : 0)); target.setHours(3,0,0,0); }
                else if (day === 5 || (day === 6 && hr < 3)) { phase = "Declaration Stage"; target.setDate(cet.getDate() + (day === 5 ? 1 : 0)); target.setHours(3,0,0,0); }
                else if (day === 6 && hr < 15) { phase = "Invitation Phase"; target.setHours(15,0,0,0); }
                else if (day === 6 && hr === 15 && min < 30) { phase = "Preparation"; target.setHours(15,30,0,0); }
                else if (day === 6 || (day === 0 && hr < 3)) { phase = "WAR ACTIVE"; target.setDate(cet.getDate() + (day === 6 ? 1 : 0)); target.setHours(3,0,0,0); }
                else { phase = "Rest Phase"; target.setDate(cet.getDate() + (day === 0 ? 1 : 7-day+1)); target.setHours(3,0,0,0); }
            }
            this.currentPhase = phase;
            const dff = target - cet;
            this.phaseCountdown = `${Math.floor(dff/36e5)}h : ${Math.floor((dff%36e5)/6e4)}m : ${Math.floor((dff%6e4)/1e3)}s`;
        },

        getGroupedFaction(fName) {
            if (!fName) return [];
            const sorted = this.factionData
                .filter(a => (a.faction || '').toLowerCase().includes(fName.toLowerCase()))
                .filter(a => this.matchesSearch(a))
                .sort((a,b) => b.stash - a.stash);

            const groups = []; 
            const step = this.week === 1 ? 10 : (this.week === 2 ? 6 : 3);
            let i = 0;
            while (i < 30 && i < sorted.length) {
                groups.push({ 
                    id: Math.floor(i/step)+1, 
                    label: `Rank ${i+1}-${Math.min(i+step, 30)}`, 
                    alliances: sorted.slice(i, i+step).map((it, idx) => ({ ...it, factionRank: i+idx+1 })) 
                });
                i += step;
            }
            if (sorted.length > 30) groups.push({ id: groups.length+1, label: "Rank 31-100", alliances: sorted.slice(30, 100).map((it, idx) => ({ ...it, factionRank: 31+idx })) });
            return groups;
        },

        get knsGroups() { return this.getGroupedFaction('Kage'); },
        get kbtGroups() { return this.getGroupedFaction('Koubu'); },

        // --- HELPERS ---
        toggleRateMode() { this.rateMode = this.rateMode === 'auto' ? 'static' : 'auto'; localStorage.setItem('war_rate_mode', this.rateMode); },
        toggleGroup(f, id) { const k = `${f}-${id}`; this.openGroups = this.openGroups.includes(k) ? this.openGroups.filter(x => x !== k) : [...this.openGroups, k]; },
        isGroupOpen(f, id) { return this.openGroups.includes(`${f}-${id}`); },
        toggleServerCollapse(s) { this.openServers = this.openServers.includes(s) ? this.openServers.filter(x => x !== s) : [...this.openServers, s]; },
        isServerOpen(s) { return this.openServers.includes(s); },
        toggleAlliance(id) { this.openAlliances = this.openAlliances.includes(id) ? this.openAlliances.filter(x => x !== id) : [...this.openAlliances, id]; },
        isAllianceOpen(id) { return this.openAlliances.includes(id); },
        formatNum(v) { return Math.floor(v || 0).toLocaleString(); },
        formatPower(v) { return (v/1e9).toFixed(2) + 'B'; },
        matchesSearch(a) { const q = this.searchQuery.toLowerCase(); return !q || a.name.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q); },
        isAllyServer(group) { const me = this.alliances.find(a => a.name === this.myAllianceName); return me ? group.some(a => (a.faction || '').toLowerCase().includes(me.faction.toLowerCase().split(' ')[0])) : true; },
        getFilteredRefList() { return [...this.alliances].sort((a,b) => a.name.localeCompare(b.name)).filter(a => !this.refSearch || a.tag.toLowerCase().includes(this.refSearch.toLowerCase())); },
        getPlayersForAlliance(id) { return this.players.filter(p => p.alliance_id === id); },
        isMatch(t) { 
            const me = this.alliances.find(a => a.name === this.myAllianceName); 
            if (!me || !t.faction || t.faction === me.faction) return false; 
            const allG = this.getGroupedFaction('Kage').concat(this.getGroupedFaction('Koubu'));
            const myG = allG.find(g => g.alliances.some(x => x.id === me.id))?.id;
            const taG = allG.find(g => g.alliances.some(x => x.id === t.id))?.id;
            return myG && taG && myG === taG; 
        },
        async login(isAuto = false) { 
            const k = isAuto ? localStorage.getItem('war_admin_key') : this.passInput;
            if(!k) return;
            const { data } = await this.client.from('authorized_managers').select('manager_name').eq('secret_key', k).single();
            if (data) { this.authenticated = true; this.managerName = data.manager_name; localStorage.setItem('war_admin_key', k); }
        },
        async processImport() {
            this.isImporting = true;
            try {
                const cleanData = JSON.parse(this.importData);
                for (const item of cleanData) {
                    const a = this.alliances.find(x => x.tag.toLowerCase() === item.tag.toLowerCase());
                    if (a) await this.client.from('history').insert({ alliance_id: a.id, copper: item.stash });
                }
                alert("Imported."); this.importData = '';
            } catch (e) { alert("Invalid JSON array."); }
            this.isImporting = false; await this.fetchData();
        },
        copyScoutPrompt() { 
            const p = `Act as an OCR data parser. Convert the following messy text into a clean JSON array.
Format: [{"tag": "MAD1", "name": "Madness", "stash": 12500000}]
Rules:
- Capture Alliance Tag (inside brackets).
- Capture Name.
- Capture Stash (remove commas/dots).
- ONLY return the JSON array.
Data:\n${this.importData}`; 
            navigator.clipboard.writeText(p); alert("AI Instructions Copied!"); 
        },
        get knsTotalStash() { return this.factionData.filter(a => (a.faction || '').toLowerCase().includes('kage')).reduce((s, a) => s + a.stash, 0); },
        get kbtTotalStash() { return this.factionData.filter(a => (a.faction || '').toLowerCase().includes('koubu')).reduce((s, a) => s + a.stash, 0); },
        get groupedForces() { const groups = {}; this.factionData.forEach(a => { if (!groups[a.server]) groups[a.server] = []; groups[a.server].push(a); }); Object.keys(groups).forEach(s => groups[s].sort((a,b) => b.ace_thp - a.ace_thp)); return groups; },
        getCityCount(n) { const a = this.alliances.find(x => x.tag === this.editTag); return a ? a['l'+n] : 0; },
        updateCity(n, d) { const a = this.alliances.find(x => x.tag === this.editTag); if (a) a['l'+n] = Math.max(0, a['l'+n] + d); },
        async saveCitiesToDB() { const a = this.alliances.find(x => x.tag === this.editTag); if (!a) return; await this.client.from('cities').upsert({ alliance_id: a.id, l1:a.l1, l2:a.l2, l3:a.l3, l4:a.l4, l5:a.l5, l6:a.l6 }); alert("Saved!"); await this.fetchData(); },
        saveSettings() { localStorage.setItem('war_ref_alliance', this.myAllianceName); }
    }
}
