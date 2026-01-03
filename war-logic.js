window.warRoom = function() {
    return {
        // --- CONFIG ---
        version: '2.3.1',
        sbUrl: 'https://kjyikmetuciyoepbdzuz.supabase.co',
        sbKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeWlrbWV0dWNpeW9lcGJkenV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNTMyNDUsImV4cCI6MjA4MjkyOTI0NX0.0bxEk7nmkW_YrlVsCeLqq8Ewebc2STx4clWgCfJus48',

        // --- STATE ---
        tab: 'warroom', loading: true, mobileMenu: false, searchQuery: '', refSearch: '', debugStatus: 'Ready',
        alliances: [], players: [], openGroups: [], openServers: [], openAlliances: [],
        authenticated: false, passInput: '', editTag: '', managerName: '',
        importData: '', isImporting: false,
        displayClock: '', currentRoundText: '', currentPhase: '', phaseCountdown: '',
        seasonStart: new Date("2026-01-05T03:00:00+01:00"), 

        async init() {
            const storedVersion = localStorage.getItem('war_app_version');
            if (storedVersion !== this.version) {
                localStorage.clear();
                localStorage.setItem('war_app_version', this.version);
                window.location.reload(true);
                return;
            }
            this.client = supabase.createClient(this.sbUrl, this.sbKey);
            this.myAllianceName = localStorage.getItem('war_ref_alliance') || '';
            await this.fetchData();

            // Auto-expand logic for my alliance
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
            try {
                const [resM, resP] = await Promise.all([
                    this.client.from('war_master_view').select('*'),
                    this.client.from('players').select('*').order('thp', { ascending: false })
                ]);
                this.alliances = resM.data || [];
                this.players = resP.data || [];
                this.debugStatus = `Strategic Intel Ready`;
            } catch (e) { console.error(e); this.debugStatus = "Sync Error"; }
            this.loading = false;
        },

        // --- MATH ENGINE (FIXED PROJECTIONS) ---
        get factionData() {
            const now = new Date();
            // Get current time in CET
            const cetNow = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            const warTime = this.getNextWarTime();

            return this.alliances.map(a => {
                // Production Rate priority: Observed (History) > Passive (Cities) > 0
                let rate = 0;
                if (Number(a.observed_rate) > 0) {
                    rate = Number(a.observed_rate);
                } else if (Number(a.city_rate) > 0) {
                    rate = Number(a.city_rate);
                }

                // 1. Calculate time passed since the scout was recorded
                const scoutTime = a.last_scout_time ? new Date(a.last_scout_time) : cetNow;
                const hoursSinceScout = Math.max(0, (cetNow - scoutTime) / 3600000);

                // 2. Calculate time from NOW until the next War Start
                const hoursUntilWar = Math.max(0, (warTime - cetNow) / 3600000);

                // 3. Current Live Estimate
                const currentStash = Number(a.last_copper || 0) + (rate * hoursSinceScout);

                // 4. War Start Estimate (Current + (rate * hours remaining))
                const warStash = currentStash + (rate * hoursUntilWar);

                return { ...a, stash: currentStash, warStash: warStash, rate: rate };
            });
        },

        getNextWarTime() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            
            // Start from today at 15:30
            let target = new Date(cet);
            target.setHours(15, 30, 0, 0);

            // Loop forward day-by-day to find the first valid Wed(3) or Sat(6) that is in the future
            let safety = 0;
            while (safety < 14) {
                const day = target.getDay();
                if ((day === 3 || day === 6) && target > cet) {
                    return target;
                }
                target.setDate(target.getDate() + 1);
                safety++;
            }
            return target;
        },

        updateClock() {
            const now = new Date();
            const cet = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
            this.displayClock = cet.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'});

            // Calculate Week Number
            const diffDays = Math.floor((cet - this.seasonStart) / 864e5);
            this.week = Math.max(1, Math.min(4, Math.floor(diffDays / 7) + 1));
            
            const day = cet.getDay(); // 0=Sun, 1=Mon, etc.
            const hr = cet.getHours();
            const min = cet.getMinutes();

            // Determine Phase & Countdown Target
            let phase = "";
            let targetTime = new Date(cet);
            targetTime.setSeconds(0, 0);

            // Round logic based on Mon-Thu and Thu-Mon
            const isR1 = (day >= 1 && day < 4 && !(day === 4 && hr >= 3));
            this.currentRoundText = `Week ${this.week} | Round ${isR1 ? 1 : 2}`;

            if (isR1) {
                // Round 1 Phases
                if (day === 1 || (day === 2 && hr < 3)) {
                    phase = "Grouping Phase"; 
                    targetTime.setDate(cet.getDate() + (day === 1 ? 1 : 0)); targetTime.setHours(3,0,0,0);
                } else if (day === 2 || (day === 3 && hr < 3)) {
                    phase = "Declaration Stage"; 
                    targetTime.setDate(cet.getDate() + (day === 2 ? 1 : 0)); targetTime.setHours(3,0,0,0);
                } else if (day === 3 && hr < 15) {
                    phase = "Invitation Phase"; 
                    targetTime.setHours(15,0,0,0);
                } else if (day === 3 && hr === 15 && min < 30) {
                    phase = "Preparation"; 
                    targetTime.setHours(15,30,0,0);
                } else {
                    phase = "WAR ACTIVE"; 
                    targetTime.setDate(cet.getDate() + 1); targetTime.setHours(3,0,0,0);
                }
            } else {
                // Round 2 Phases
                if (day === 4 || (day === 5 && hr < 3)) {
                    phase = "Grouping Phase"; 
                    targetTime.setDate(cet.getDate() + (day === 4 ? 1 : 0)); targetTime.setHours(3,0,0,0);
                } else if (day === 5 || (day === 6 && hr < 3)) {
                    phase = "Declaration Stage"; 
                    targetTime.setDate(cet.getDate() + (day === 5 ? 1 : 0)); targetTime.setHours(3,0,0,0);
                } else if (day === 6 && hr < 15) {
                    phase = "Invitation Phase"; 
                    targetTime.setHours(15,0,0,0);
                } else if (day === 6 && hr === 15 && min < 30) {
                    phase = "Preparation"; 
                    targetTime.setHours(15,30,0,0);
                } else if (day === 6 || (day === 0 && hr < 3)) {
                    phase = "WAR ACTIVE"; 
                    targetTime.setDate(cet.getDate() + (day === 6 ? 1 : 0)); targetTime.setHours(3,0,0,0);
                } else {
                    phase = "Rest Phase"; 
                    targetTime.setDate(cet.getDate() + (day === 0 ? 1 : 7-day+1)); targetTime.setHours(3,0,0,0);
                }
            }

            this.currentPhase = phase;
            const dff = targetTime - cet;
            this.phaseCountdown = `${Math.floor(dff/36e5)}h : ${Math.floor((dff%36e5)/6e4)}m : ${Math.floor((dff%6e4)/1e3)}s`;
        },

        getGroupedFaction(fName) {
            const sorted = this.factionData
                .filter(a => a.faction.toLowerCase().includes(fName.toLowerCase()))
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
            if (sorted.length > 30) {
                groups.push({ id: groups.length + 1, label: "Rank 31-100", alliances: sorted.slice(30, 100).map((it, idx) => ({ ...it, factionRank: 31+idx })) });
            }
            return groups;
        },

        // --- HELPERS ---
        get knsGroups() { return this.getGroupedFaction('Kage'); },
        get kbtGroups() { return this.getGroupedFaction('Koubu'); },
        get knsTotalStash() { return this.factionData.filter(a => a.faction.toLowerCase().includes('kage')).reduce((s, a) => s + a.stash, 0); },
        get kbtTotalStash() { return this.factionData.filter(a => a.faction.toLowerCase().includes('koubu')).reduce((s, a) => s + a.stash, 0); },
        get groupedForces() {
            const groups = {};
            this.factionData.forEach(a => {
                if (!groups[a.server]) groups[a.server] = [];
                groups[a.server].push(a);
            });
            Object.keys(groups).forEach(s => groups[s].sort((a,b) => b.ace_thp - a.ace_thp));
            return groups;
        },
        getPlayersForAlliance(id) { return this.players.filter(p => p.alliance_id === id); },
        toggleGroup(f, id) { const key = `${f}-${id}`; this.openGroups = this.openGroups.includes(key) ? this.openGroups.filter(k => k !== key) : [...this.openGroups, key]; },
        isGroupOpen(f, id) { return this.openGroups.includes(`${f}-${id}`); },
        toggleServerCollapse(s) { this.openServers = this.openServers.includes(s) ? this.openServers.filter(x => x !== s) : [...this.openServers, s]; },
        isServerOpen(s) { return this.openServers.includes(s); },
        toggleAlliance(id) { this.openAlliances = this.openAlliances.includes(id) ? this.openAlliances.filter(x => x !== id) : [...this.openAlliances, id]; },
        isAllianceOpen(id) { return this.openAlliances.includes(id); },
        formatNum(v) { return Math.floor(v || 0).toLocaleString(); },
        formatPower(v) { return (v/1000000000).toFixed(2) + 'B'; },
        matchesSearch(a) { const q = this.searchQuery.toLowerCase(); return !q || a.name.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q); },
        getFilteredRefList() { return [...this.alliances].sort((a,b) => a.name.localeCompare(b.name)).filter(a => !this.refSearch || a.tag.toLowerCase().includes(this.refSearch.toLowerCase())); },
        isAllyServer(group) { const me = this.alliances.find(a => a.name === this.myAllianceName); return me ? group.some(a => a.faction === me.faction) : true; },
        isMatch(t) { 
            const me = this.alliances.find(a => a.name === this.myAllianceName); 
            if (!me || !t.faction || !me.faction || t.faction === me.faction || t.faction === 'Unassigned') return false; 
            const myG = this.getGroupedFaction(me.faction).find(g => g.alliances.some(x => x.id === me.id))?.id;
            const taG = this.getGroupedFaction(t.faction).find(g => g.alliances.some(x => x.tag === t.tag))?.id;
            return myG && taG && myG === taG; 
        },

        // --- ADMIN ---
        copyScoutPrompt() { 
            const prompt = `I am providing raw OCR text from a screenshot of an alliance list. Please extract the Tag, Name, and Stash (Copper) value into a JSON array. 
            RULES: 
            1. Find the Alliance Tag (usually inside brackets like [TAG]).
            2. Find the Alliance Name next to the tag.
            3. Find the large number representing the stash (remove all commas/dots).
            4. Output ONLY the raw JSON array.
            Format: [{"tag": "TAG", "name": "Name", "stash": 12345000}]
            
            OCR DATA:
            ${this.importData}`;
            navigator.clipboard.writeText(prompt);
            alert("High-Precision AI Prompt Copied!");
        },
        async login(isAuto = false) {
            const { data } = await this.client.from('authorized_managers').select('manager_name').eq('secret_key', this.passInput).single();
            if (data) { this.authenticated = true; this.managerName = data.manager_name; localStorage.setItem('war_admin_key', this.passInput); }
        },
        async saveCitiesToDB() {
            const a = this.alliances.find(x => x.tag === this.editTag);
            if (!a) return;
            await this.client.from('cities').upsert({ alliance_id: a.id, l1:a.l1, l2:a.l2, l3:a.l3, l4:a.l4, l5:a.l5, l6:a.l6 });
            alert("Cities Saved!"); await this.fetchData();
        },
        async processImport() {
            this.isImporting = true;
            try {
                const cleanData = JSON.parse(this.importData);
                let count = 0;
                for (const item of cleanData) {
                    const alliance = this.alliances.find(a => a.tag.toLowerCase() === item.tag.toLowerCase());
                    if (alliance) {
                        await this.client.from('history').insert({ alliance_id: alliance.id, copper: item.stash });
                        count++;
                    }
                }
                alert(`Imported ${count} alliance scouts.`);
                this.importData = '';
            } catch (e) {
                alert("Error: Invalid JSON format. Please use the AI prompt from Step 1.");
            }
            this.isImporting = false;
            await this.fetchData();
        },
        getCityCount(n) { const a = this.alliances.find(x => x.tag === this.editTag); return a ? a['l'+n] : 0; },
        getTotalCities() { const a = this.alliances.find(x => x.tag === this.editTag); return a ? [1,2,3,4,5,6].reduce((s,i)=>s+Number(a['l'+i]),0) : 0; },
        updateCity(n, d) { const a = this.alliances.find(x => x.tag === this.editTag); if (a) { if (d > 0 && this.getTotalCities() >= 6) return alert("Max 6 cities!"); a['l'+n] = Math.max(0, Number(a['l'+n]) + d); }},
        saveSettings() { localStorage.setItem('war_ref_alliance', this.myAllianceName); }
    }
}
